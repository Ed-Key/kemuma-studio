import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'
import { listEvents } from '@/lib/catalog/catalog'
import { createIntake, getIntake, listPendingIntakes, confirmIntake } from '@/lib/catalog/intakes'

describe('intakes', () => {
  let db: Db
  beforeEach(() => {
    db = openDb(path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-intake-')), 'c.sqlite'))
  })

  it('creates and fetches an intake', () => {
    const id = createIntake(db, { dir: 'data/intake/x', photos_json: '["a.jpg"]', proposal_json: '{"decision":"new"}' })
    const rec = getIntake(db, id)
    expect(rec?.status).toBe('pending')
    expect(rec?.dir).toBe('data/intake/x')
    expect(listEvents(db).some((e) => e.type === 'intake.created')).toBe(true)
  })

  it('lists pending newest first and hides confirmed', () => {
    const a = createIntake(db, { dir: 'a', photos_json: '[]' })
    const b = createIntake(db, { dir: 'b', photos_json: '[]' })
    confirmIntake(db, a)
    const pending = listPendingIntakes(db)
    expect(pending.map((i) => i.intake_id)).toEqual([b])
    expect(getIntake(db, a)?.status).toBe('confirmed')
  })
})
