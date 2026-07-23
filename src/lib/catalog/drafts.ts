import type { Db } from './db'
import { logEvent } from './catalog'

export interface ListingDraftRecord {
  draft_id: number
  design_id: number
  status: 'generated' | 'approved'
  generated_json: string
  final_json: string | null
  model: string
  created_at: string
}

export function createDraft(db: Db, input: { design_id: number; generated_json: string; model: string }): number {
  const res = db
    .prepare('INSERT INTO drafts (design_id, generated_json, model) VALUES (?, ?, ?)')
    .run(input.design_id, input.generated_json, input.model)
  const id = Number(res.lastInsertRowid)
  logEvent(db, 'draft.generated', { draft_id: id, design_id: input.design_id, model: input.model })
  return id
}

export function latestDraftForDesign(db: Db, designId: number): ListingDraftRecord | null {
  const row = db
    .prepare('SELECT * FROM drafts WHERE design_id = ? ORDER BY draft_id DESC LIMIT 1')
    .get(designId) as ListingDraftRecord | undefined
  return row ?? null
}

export function approveDraft(db: Db, input: { draft_id: number; final_json: string; edited_fields: string[] }): void {
  db.prepare("UPDATE drafts SET status = 'approved', final_json = ? WHERE draft_id = ?").run(
    input.final_json,
    input.draft_id
  )
  logEvent(db, 'draft.approved', { draft_id: input.draft_id, edited_fields: input.edited_fields })
}
