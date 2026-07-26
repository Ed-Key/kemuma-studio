'use server'

import { revalidatePath } from 'next/cache'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { getCatalogDb } from '@/lib/catalog/instance'
import { create as createJob } from '@/lib/catalog/jobs'
import { approveDraft, getDraft, latestDraftForDesign } from '@/lib/catalog/drafts'
import { runJobOperation, type JobInput } from '@/lib/jobs/operations'
import { startJob } from '@/lib/jobs/schedule'
import { ListingDraftSchema, validateEtsyRules } from '@/lib/writer/schema'
import type { ActionResult } from '../../../components/action-result'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function generateDraftAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    if (!Number.isInteger(designId) || designId < 1) throw new Error('invalid design')
    const db = getCatalogDb()
    const detail = getDesignDetail(db, designId)
    if (!detail) throw new Error(`design ${designId} not found`)
    const destination = `/designs/${designId}/draft`
    const input: JobInput = { kind: 'listing_copy', designId }
    const jobId = createJob(db, {
      kind: 'listing_copy',
      design_id: designId,
      title: `Listing copy · ${detail.name}`,
      destination,
      input,
    })
    startJob(db, jobId, () => runJobOperation(db, input, jobId))
    return { ok: true, message: 'Listing copy started in the rail.', jobId }
  } catch (err) {
    return { ok: false, message: 'Could not write the listing.', detail: errText(err) }
  }
}

export async function approveDraftAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const db = getCatalogDb()
    const designId = Number(formData.get('design_id'))
    const draftId = Number(formData.get('draft_id'))

    const final = ListingDraftSchema.parse({
      title: String(formData.get('title') ?? ''),
      description: String(formData.get('description') ?? ''),
      tags: Array.from({ length: 13 }, (_, i) => String(formData.get(`tag_${i}`) ?? '').trim()),
      price_usd: Number(formData.get('price_usd')),
      price_justification: String(formData.get('price_justification') ?? ''),
      materials: String(formData.get('materials') ?? '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      colorway_notes: String(formData.get('colorway_notes') ?? ''),
      primary_color: (formData.get('primary_color') as string) || null,
      secondary_color: (formData.get('secondary_color') as string) || null,
      art_style: (formData.get('art_style') as string) || null,
    })
    const errors = validateEtsyRules(final)
    if (errors.length > 0) throw new Error(`fix before approving: ${errors.join('; ')}`)

    const record = latestDraftForDesign(db, designId)
    if (!record || record.draft_id !== draftId) throw new Error('draft is stale; regenerate')
    const generated = JSON.parse(record.generated_json)
    const editedFields = (Object.keys(final) as Array<keyof typeof final>).filter(
      (k) => JSON.stringify(final[k]) !== JSON.stringify(generated[k])
    )

    approveDraft(db, { draft_id: draftId, final_json: JSON.stringify(final), edited_fields: editedFields })
    revalidatePath(`/designs/${designId}/draft`)
    return { ok: true, message: 'Draft approved. Ready to push to Etsy.' }
  } catch (err) {
    return { ok: false, message: 'Could not approve the draft.', detail: errText(err) }
  }
}

export async function pushToEtsyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const { createEtsyGateway } = await import('@/lib/etsy/gateway')
    const { getValidAccessToken } = await import('@/lib/etsy/tokens')
    const { etsyConfig } = await import('@/lib/etsy/config')
    const { pushDraftToEtsy } = await import('@/lib/etsy/push')
    const { dataDir } = await import('@/lib/catalog/instance')
    const cfg = etsyConfig()
    const gateway = createEtsyGateway({
      keystring: cfg.keystring,
      sharedSecret: cfg.sharedSecret,
      getAccessToken: () => getValidAccessToken(fetch, cfg.dataDir, cfg.keystring),
    })
    const res = await pushDraftToEtsy(getCatalogDb(), gateway, designId, dataDir())
    revalidatePath(`/designs/${designId}/draft`)
    return {
      ok: true,
      message: res.created
        ? 'Created a draft listing on Etsy.'
        : 'Updated the Etsy listing. Photos are left alone on an update.',
      detail: `listing ${res.listing_id} · ${res.images_uploaded} images · ${res.attributes_set} attributes${
        res.video_uploaded ? ' · video' : ''
      }${res.variations_set ? ' · variations set' : ''}`,
      warnings: res.warnings,
    }
  } catch (err) {
    return { ok: false, message: 'Could not push to Etsy.', detail: errText(err) }
  }
}
