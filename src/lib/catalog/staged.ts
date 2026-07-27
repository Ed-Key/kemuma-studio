import type { Db } from './db'
import { logEvent } from './catalog'

// AI-staged marketing images. Deliberately disconnected from src/lib/etsy:
// Etsy's Creativity Standards require real photographs in listing galleries,
// so staged images only ever ship to marketing destinations.
// The gallery exclusion was relaxed behind a deliberate per-click owner action.
export const DESTINATIONS = ['social', 'pinterest', 'storefront', 'storyboard'] as const
export type Destination = (typeof DESTINATIONS)[number]
export const REJECT_REASONS = [
  'wrong_object',
  'lost_detail',
  'wrong_count',
  'broke_plan',
  'looks_fake',
  'not_wanted',
] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

export interface StagedImageRecord {
  staged_id: number
  design_id: number
  scene_key: string
  source_photo_id: number
  prompt: string
  file_path: string
  status: 'candidate' | 'approved' | 'rejected'
  destination: Destination | null
  reject_reason: string | null
  reject_note: string | null
  prompt_version: string | null
  model: string
  cost_usd: number | null
  etsy_uploaded_at: string | null
  created_at: string
}

export function createStagedImage(
  db: Db,
  input: {
    design_id: number
    scene_key: string
    source_photo_id: number
    prompt: string
    file_path: string
    model: string
    cost_usd?: number | null
    prompt_version?: string | null
    plan_json?: string | null
  }
): number {
  const res = db
    .prepare(`
      INSERT INTO staged_images
        (design_id, scene_key, source_photo_id, prompt, file_path, model, cost_usd, prompt_version, plan_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.design_id,
      input.scene_key,
      input.source_photo_id,
      input.prompt,
      input.file_path,
      input.model,
      input.cost_usd ?? null,
      input.prompt_version ?? null,
      input.plan_json ?? null
    )
  const id = Number(res.lastInsertRowid)
  logEvent(db, 'stage.generated', {
    staged_id: id,
    design_id: input.design_id,
    scene_key: input.scene_key,
    cost_usd: input.cost_usd ?? null,
  })
  return id
}

export function getStagedImage(db: Db, stagedId: number): StagedImageRecord | null {
  const row = db.prepare('SELECT * FROM staged_images WHERE staged_id = ?').get(stagedId) as
    | StagedImageRecord
    | undefined
  return row ?? null
}

export function listStagedForDesign(db: Db, designId: number): StagedImageRecord[] {
  return db
    .prepare('SELECT * FROM staged_images WHERE design_id = ? ORDER BY staged_id DESC')
    .all(designId) as StagedImageRecord[]
}

export function sceneUsageForDesign(db: Db, designId: number): Record<string, number> {
  const rows = db
    .prepare('SELECT scene_key, COUNT(*) AS n FROM staged_images WHERE design_id = ? GROUP BY scene_key')
    .all(designId) as Array<{ scene_key: string; n: number }>
  return Object.fromEntries(rows.map((r) => [r.scene_key, r.n]))
}

export function approveStagedImage(db: Db, input: { staged_id: number; destination: Destination }): void {
  if (!DESTINATIONS.includes(input.destination)) {
    throw new Error(`unknown destination "${input.destination}"`)
  }
  db.prepare(
    "UPDATE staged_images SET status = 'approved', destination = ?, reject_reason = NULL, reject_note = NULL WHERE staged_id = ?"
  ).run(
    input.destination,
    input.staged_id
  )
  logEvent(db, 'stage.approved', { staged_id: input.staged_id, destination: input.destination })
}

export function rejectStagedImage(
  db: Db,
  stagedId: number,
  reason: RejectReason,
  note?: string
): void {
  if (!REJECT_REASONS.includes(reason)) {
    throw new Error(`unknown reject reason "${reason}"`)
  }
  // The six categories are for counting; the note is for the observation that
  // does not fit one, which is usually the one worth acting on. "Lighting and
  // shadows disagree about the light source" and "looks fake" are the same
  // category at completely different resolutions.
  const trimmed = note?.trim() || null
  db.prepare(
    "UPDATE staged_images SET status = 'rejected', destination = NULL, reject_reason = ?, reject_note = ? WHERE staged_id = ?"
  ).run(reason, trimmed, stagedId)
  logEvent(db, 'stage.rejected', { staged_id: stagedId, reason, note: trimmed })
}

export function listApprovedImages(db: Db): Array<StagedImageRecord & { design_name: string }> {
  return db
    .prepare(`
      SELECT s.*, d.name AS design_name
      FROM staged_images s
      JOIN designs d ON d.design_id = s.design_id
      WHERE s.status = 'approved'
      ORDER BY s.destination, s.staged_id DESC
    `)
    .all() as Array<StagedImageRecord & { design_name: string }>
}

// Owner's override (2026-07-24): scenes can ship to a listing gallery through
// an explicit action; this records that it happened.
export function markStagedUploaded(db: Db, stagedId: number): void {
  db.prepare("UPDATE staged_images SET etsy_uploaded_at = datetime('now') WHERE staged_id = ?").run(stagedId)
  logEvent(db, 'stage.attached', { staged_id: stagedId })
}
