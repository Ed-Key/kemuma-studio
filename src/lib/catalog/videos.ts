import type { Db } from './db'
import { logEvent } from './catalog'

export interface VideoRecord {
  video_id: number
  piece_id: number
  file_path: string
  etsy_uploaded_at: string | null
  created_at: string
}

export function addVideo(db: Db, input: { piece_id: number; file_path: string }): number {
  const res = db
    .prepare('INSERT INTO videos (piece_id, file_path) VALUES (?, ?)')
    .run(input.piece_id, input.file_path)
  const id = Number(res.lastInsertRowid)
  logEvent(db, 'video.added', { video_id: id, piece_id: input.piece_id })
  return id
}

/**
 * The clip this design would send to Etsy, if any.
 *
 * Oldest first, because the first thing filmed is the one the owner shot
 * deliberately; later clips tend to be second attempts at other pieces.
 */
export function videoForDesign(db: Db, designId: number): VideoRecord | null {
  const row = db
    .prepare(`
      SELECT v.* FROM videos v
      JOIN pieces p ON p.piece_id = v.piece_id
      WHERE p.design_id = ?
      ORDER BY v.video_id ASC
      LIMIT 1
    `)
    .get(designId) as VideoRecord | undefined
  return row ?? null
}

export function listVideosForDesign(db: Db, designId: number): VideoRecord[] {
  return db
    .prepare(`
      SELECT v.* FROM videos v
      JOIN pieces p ON p.piece_id = v.piece_id
      WHERE p.design_id = ?
      ORDER BY v.video_id ASC
    `)
    .all(designId) as VideoRecord[]
}

export function markVideoUploaded(db: Db, videoId: number): void {
  db.prepare("UPDATE videos SET etsy_uploaded_at = datetime('now') WHERE video_id = ?").run(videoId)
  logEvent(db, 'video.attached', { video_id: videoId })
}
