import type { Db } from './db'
import { logEvent } from './catalog'

// Dimension cards are annotated REAL photos (no generative AI), so unlike
// staged_images they are eligible for Etsy listing galleries.
export interface DimensionCardRecord {
  card_id: number
  design_id: number
  source_photo_id: number
  file_path: string
  height_in: number
  width_in: number
  status: 'candidate' | 'approved' | 'rejected'
  created_at: string
}

export function createDimensionCard(
  db: Db,
  input: { design_id: number; source_photo_id: number; file_path: string; height_in: number; width_in: number }
): number {
  const res = db
    .prepare(`
      INSERT INTO dimension_cards (design_id, source_photo_id, file_path, height_in, width_in)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(input.design_id, input.source_photo_id, input.file_path, input.height_in, input.width_in)
  const id = Number(res.lastInsertRowid)
  logEvent(db, 'dimcard.generated', { card_id: id, design_id: input.design_id })
  return id
}

export function getDimensionCard(db: Db, cardId: number): DimensionCardRecord | null {
  const row = db.prepare('SELECT * FROM dimension_cards WHERE card_id = ?').get(cardId) as
    | DimensionCardRecord
    | undefined
  return row ?? null
}

export function listDimensionCardsForDesign(db: Db, designId: number): DimensionCardRecord[] {
  return db
    .prepare('SELECT * FROM dimension_cards WHERE design_id = ? ORDER BY card_id DESC')
    .all(designId) as DimensionCardRecord[]
}

export function approveDimensionCard(db: Db, cardId: number): void {
  db.prepare("UPDATE dimension_cards SET status = 'approved' WHERE card_id = ?").run(cardId)
  logEvent(db, 'dimcard.approved', { card_id: cardId })
}

export function rejectDimensionCard(db: Db, cardId: number): void {
  db.prepare("UPDATE dimension_cards SET status = 'rejected' WHERE card_id = ?").run(cardId)
  logEvent(db, 'dimcard.rejected', { card_id: cardId })
}

export function latestApprovedCardForDesign(db: Db, designId: number): DimensionCardRecord | null {
  const row = db
    .prepare(
      "SELECT * FROM dimension_cards WHERE design_id = ? AND status = 'approved' ORDER BY card_id DESC LIMIT 1"
    )
    .get(designId) as DimensionCardRecord | undefined
  return row ?? null
}
