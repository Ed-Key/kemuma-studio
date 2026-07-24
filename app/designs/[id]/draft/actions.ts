'use server'

import { revalidatePath } from 'next/cache'
import { getCatalogDb } from '@/lib/catalog/instance'
import { approveDraft, latestDraftForDesign } from '@/lib/catalog/drafts'
import { createClaudeWriter, generateDraft } from '@/lib/writer/generate'
import { ListingDraftSchema, validateEtsyRules } from '@/lib/writer/schema'

export async function generateDraftAction(formData: FormData) {
  const designId = Number(formData.get('design_id'))
  await generateDraft(getCatalogDb(), createClaudeWriter(), designId)
  revalidatePath(`/designs/${designId}/draft`)
}

export async function approveDraftAction(formData: FormData) {
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
}

export async function pushToEtsyAction(formData: FormData) {
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
}
