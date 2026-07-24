import type { Db } from './db'
import { logEvent } from './catalog'

export interface IntakeRecord {
  intake_id: number
  dir: string
  photos_json: string
  proposal_json: string | null
  status: 'pending' | 'confirmed'
  created_at: string
}

export function createIntake(db: Db, input: { dir: string; photos_json: string; proposal_json?: string }): number {
  const res = db
    .prepare('INSERT INTO intakes (dir, photos_json, proposal_json) VALUES (?, ?, ?)')
    .run(input.dir, input.photos_json, input.proposal_json ?? null)
  const id = Number(res.lastInsertRowid)
  logEvent(db, 'intake.created', { intake_id: id, dir: input.dir })
  return id
}

export function getIntake(db: Db, intakeId: number): IntakeRecord | null {
  const row = db.prepare('SELECT * FROM intakes WHERE intake_id = ?').get(intakeId) as IntakeRecord | undefined
  return row ?? null
}

export function listPendingIntakes(db: Db): IntakeRecord[] {
  return db.prepare("SELECT * FROM intakes WHERE status = 'pending' ORDER BY intake_id DESC").all() as IntakeRecord[]
}

export function confirmIntake(db: Db, intakeId: number): void {
  db.prepare("UPDATE intakes SET status = 'confirmed' WHERE intake_id = ?").run(intakeId)
  logEvent(db, 'intake.confirmed', { intake_id: intakeId })
}
