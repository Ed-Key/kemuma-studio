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
  usage_json: string | null
  cost_usd: number | null
}

export function createDraft(
  db: Db,
  input: { design_id: number; generated_json: string; model: string; usage_json?: string; cost_usd?: number | null }
): number {
  const res = db
    .prepare('INSERT INTO drafts (design_id, generated_json, model, usage_json, cost_usd) VALUES (?, ?, ?, ?, ?)')
    .run(input.design_id, input.generated_json, input.model, input.usage_json ?? null, input.cost_usd ?? null)
  const id = Number(res.lastInsertRowid)
  logEvent(db, 'draft.generated', { draft_id: id, design_id: input.design_id, model: input.model, cost_usd: input.cost_usd ?? null })
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

export function listLatestDraftPerModel(db: Db, designId: number): ListingDraftRecord[] {
  return db
    .prepare(`
      SELECT d.* FROM drafts d
      JOIN (SELECT model, MAX(draft_id) AS max_id FROM drafts WHERE design_id = ? GROUP BY model) m
        ON d.draft_id = m.max_id
      ORDER BY d.draft_id
    `)
    .all(designId) as ListingDraftRecord[]
}
