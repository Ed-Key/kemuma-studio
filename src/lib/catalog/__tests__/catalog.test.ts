import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'

function tempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-db-')), 'catalog.sqlite')
}

describe('openDb', () => {
  it('creates the schema idempotently', () => {
    const file = tempDbPath()
    const db1 = openDb(file)
    db1.close()
    const db2 = openDb(file) // second open must not throw
    const tables = db2
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toEqual(expect.arrayContaining(['designs', 'events', 'photos', 'pieces']))
    db2.close()
  })

  it('enforces foreign keys', () => {
    const db = openDb(tempDbPath())
    expect(() =>
      db.prepare(
        "INSERT INTO pieces (design_id, colorway, height_in, width_in, depth_in, weight_lb) VALUES (999, 'gray', 5, 3, 3, 2)"
      ).run()
    ).toThrow(/FOREIGN KEY/)
    db.close()
  })
})
