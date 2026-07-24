'use server'

import { redirect } from 'next/navigation'
import { getCatalogDb } from '@/lib/catalog/instance'
import { logEvent } from '@/lib/catalog/catalog'
import { createDraft } from '@/lib/catalog/drafts'
import type { ListingDraftRecord } from '@/lib/catalog/drafts'

export async function chooseWinnerAction(formData: FormData) {
  const db = getCatalogDb()
  const designId = Number(formData.get('design_id'))
  const sourceDraftId = Number(formData.get('draft_id'))
  const row = db.prepare('SELECT * FROM drafts WHERE draft_id = ?').get(sourceDraftId) as ListingDraftRecord | undefined
  if (!row || row.design_id !== designId) throw new Error('draft not found for this design')
  createDraft(db, {
    design_id: designId,
    generated_json: row.generated_json,
    model: row.model,
    usage_json: row.usage_json ?? undefined,
    cost_usd: row.cost_usd,
  })
  logEvent(db, 'bakeoff.winner', { design_id: designId, model: row.model, source_draft_id: sourceDraftId })
  redirect(`/designs/${designId}/draft`)
}
