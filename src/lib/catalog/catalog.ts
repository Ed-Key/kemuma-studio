import type { Db } from './db'

export function logEvent(db: Db, type: string, payload: unknown): void {
  db.prepare('INSERT INTO events (type, payload) VALUES (?, ?)').run(type, JSON.stringify(payload))
}

export function listEvents(db: Db, limit = 100): Array<{ event_id: number; ts: string; type: string; payload: string }> {
  return db.prepare('SELECT event_id, ts, type, payload FROM events ORDER BY event_id DESC LIMIT ?').all(limit) as never
}

export function createDesign(db: Db, input: { family: string; name: string; notes?: string }): number {
  const res = db
    .prepare('INSERT INTO designs (family, name, notes) VALUES (?, ?, ?)')
    .run(input.family, input.name, input.notes ?? null)
  const id = Number(res.lastInsertRowid)
  logEvent(db, 'design.created', { design_id: id, family: input.family, name: input.name })
  return id
}

export function listDesigns(db: Db): Array<{ design_id: number; family: string; name: string; piece_count: number; total_quantity: number }> {
  return db
    .prepare(`
      SELECT d.design_id, d.family, d.name,
             COUNT(p.piece_id) AS piece_count,
             COALESCE(SUM(p.quantity), 0) AS total_quantity
      FROM designs d
      LEFT JOIN pieces p ON p.design_id = d.design_id
      GROUP BY d.design_id
      ORDER BY d.name
    `)
    .all() as never
}

export function addPiece(
  db: Db,
  input: {
    design_id: number
    colorway: string
    finish?: string
    height_in: number
    width_in: number
    depth_in: number
    weight_lb: number
    quantity?: number
    condition_notes?: string
  }
): number {
  const res = db
    .prepare(`
      INSERT INTO pieces (design_id, colorway, finish, height_in, width_in, depth_in, weight_lb, quantity, condition_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.design_id,
      input.colorway,
      input.finish ?? null,
      input.height_in,
      input.width_in,
      input.depth_in,
      input.weight_lb,
      input.quantity ?? 1,
      input.condition_notes ?? null
    )
  const id = Number(res.lastInsertRowid)
  logEvent(db, 'piece.added', { piece_id: id, design_id: input.design_id, colorway: input.colorway })
  return id
}

export function addPhoto(db: Db, input: { piece_id: number; file_path: string; position: number }): number {
  const res = db
    .prepare('INSERT INTO photos (piece_id, file_path, position) VALUES (?, ?, ?)')
    .run(input.piece_id, input.file_path, input.position)
  const id = Number(res.lastInsertRowid)
  logEvent(db, 'photo.added', { photo_id: id, piece_id: input.piece_id })
  return id
}

export function getPhotoPath(db: Db, photoId: number): string | null {
  const row = db.prepare('SELECT file_path FROM photos WHERE photo_id = ?').get(photoId) as { file_path: string } | undefined
  return row?.file_path ?? null
}

export function getDesignDetail(db: Db, designId: number) {
  const design = db
    .prepare('SELECT design_id, family, name, notes, etsy_listing_id FROM designs WHERE design_id = ?')
    .get(designId) as
    | { design_id: number; family: string; name: string; notes: string | null; etsy_listing_id: number | null }
    | undefined
  if (!design) return null
  const pieces = db
    .prepare(`
      SELECT piece_id, colorway, finish, height_in, width_in, depth_in, weight_lb, quantity, condition_notes, status
      FROM pieces WHERE design_id = ? ORDER BY piece_id
    `)
    .all(designId) as Array<{
    piece_id: number
    colorway: string
    finish: string | null
    height_in: number
    width_in: number
    depth_in: number
    weight_lb: number
    quantity: number
    condition_notes: string | null
    status: string
  }>
  const photoStmt = db.prepare('SELECT photo_id, position FROM photos WHERE piece_id = ? ORDER BY position')
  return {
    ...design,
    pieces: pieces.map((p) => ({ ...p, photos: photoStmt.all(p.piece_id) as Array<{ photo_id: number; position: number }> })),
  }
}

export function setDesignEtsyListingId(db: Db, designId: number, listingId: number): void {
  db.prepare('UPDATE designs SET etsy_listing_id = ? WHERE design_id = ?').run(listingId, designId)
  logEvent(db, 'etsy.listing_linked', { design_id: designId, etsy_listing_id: listingId })
}

export function markDesignPiecesListed(db: Db, designId: number): void {
  db.prepare("UPDATE pieces SET status = 'listed' WHERE design_id = ?").run(designId)
  logEvent(db, 'pieces.listed', { design_id: designId })
}
