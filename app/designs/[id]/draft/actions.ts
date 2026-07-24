'use server'

import { revalidatePath } from 'next/cache'
import { getCatalogDb } from '@/lib/catalog/instance'
import { approveDraft, latestDraftForDesign } from '@/lib/catalog/drafts'
import { createClaudeWriter, generateDraft } from '@/lib/writer/generate'
import { ListingDraftSchema, validateEtsyRules } from '@/lib/writer/schema'
import { getDesignDetail } from '@/lib/catalog/catalog'
import type { ActionResult } from '../../../components/action-result'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function generateDraftAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    await generateDraft(getCatalogDb(), createClaudeWriter(), designId)
    revalidatePath(`/designs/${designId}/draft`)
    return { ok: true, message: 'Listing copy written.' }
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
    await pushDraftToEtsy(getCatalogDb(), gateway, designId, dataDir())
    revalidatePath(`/designs/${designId}/draft`)
    const listingId = getDesignDetail(getCatalogDb(), designId)?.etsy_listing_id
    return {
      ok: true,
      message: 'Pushed to Etsy as a draft listing.',
      detail: listingId ? `listing ${listingId}` : undefined,
    }
  } catch (err) {
    return { ok: false, message: 'Could not push to Etsy.', detail: errText(err) }
  }
}
