import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb } from '@/lib/catalog/db'

/* The backfill that decides what gets re-sent to a live Etsy shop.
 *
 * It runs once, against a catalogue that cannot be re-derived, and getting it
 * wrong means duplicate images on listings that take real money. Everything
 * below is a shape the production catalogue actually holds: designs carrying
 * more than the ten photos the old uploader attempted, photo ids reused across
 * catalogue rebuilds, and push events naming the uploads that failed.
 *
 * The fixture writes the schema as it stood before this column existed, so
 * openDb has to migrate it rather than create it.
 */
function legacyCatalogue(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-backfill-')), 'catalog.sqlite')
  const db = new Database(file)
  db.exec(`
    CREATE TABLE designs (
      design_id INTEGER PRIMARY KEY, family TEXT NOT NULL, name TEXT NOT NULL,
      notes TEXT, etsy_listing_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE pieces (
      piece_id INTEGER PRIMARY KEY, design_id INTEGER NOT NULL REFERENCES designs(design_id),
      colorway TEXT NOT NULL, height_in REAL, width_in REAL, depth_in REAL, weight_lb REAL,
      quantity INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE photos (
      photo_id INTEGER PRIMARY KEY, piece_id INTEGER NOT NULL REFERENCES pieces(piece_id),
      file_path TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE events (
      event_id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')),
      type TEXT NOT NULL, payload TEXT NOT NULL
    );
  `)
  const design = db.prepare('INSERT INTO designs (design_id, family, name, etsy_listing_id) VALUES (?,?,?,?)')
  const piece = db.prepare('INSERT INTO pieces (piece_id, design_id, colorway) VALUES (?,?,?)')
  const photo = db.prepare('INSERT INTO photos (photo_id, piece_id, file_path, position) VALUES (?,?,?,?)')

  // Listed, twelve photos. Only the first ten were ever attempted.
  design.run(1, 'heart dish', 'Twelve Photo Dish', 900001)
  piece.run(10, 1, 'maroon')
  for (let i = 0; i < 12; i++) photo.run(100 + i, 10, `/tmp/a${i}.jpg`, i)

  // Listed, three photos, the middle one recorded as failed. Note it does not
  // own 201: that number went to another design when the catalogue was rebuilt.
  design.run(2, 'figure', 'Dropped Middle', 900002)
  piece.run(20, 2, 'gray')
  for (const id of [200, 202, 203]) photo.run(id, 20, `/tmp/b${id}.jpg`, id - 200)

  // Never pushed. Nothing here should be stamped.
  design.run(3, 'bowl', 'Never Listed', null)
  piece.run(30, 3, 'olive')
  for (let i = 0; i < 3; i++) photo.run(300 + i, 30, `/tmp/c${i}.jpg`, i)

  // A listed design holding the id that design 2's old warning named. This is
  // the reuse hazard: same number, different photo, a rebuild apart.
  design.run(4, 'coaster set', 'Recycled Id', 900004)
  piece.run(40, 4, 'blue')
  photo.run(201, 40, '/tmp/d0.jpg', 0)

  const event = db.prepare("INSERT INTO events (type, payload) VALUES ('etsy.pushed', ?)")
  event.run(JSON.stringify({ design_id: 2, warnings: ['image 202 failed to upload: fetch failed'] }))
  event.run(JSON.stringify({ design_id: 2, warnings: ['image 201 failed to upload: fetch failed'] }))
  event.run(JSON.stringify({ design_id: 1, warnings: ['measurements are estimated'] }))
  event.run(JSON.stringify({ design_id: 99, warnings: ['image 100 failed to upload: fetch failed'] }))
  db.close()
  return file
}

const stamped = (file: string) => {
  const db = new Database(file, { readonly: true })
  const rows = db.prepare('SELECT photo_id, etsy_uploaded_at FROM photos ORDER BY photo_id').all() as Array<{
    photo_id: number
    etsy_uploaded_at: string | null
  }>
  db.close()
  return new Map(rows.map((r) => [r.photo_id, r.etsy_uploaded_at !== null]))
}

describe('the backfill that decides what gets re-sent to Etsy', () => {
  it('stamps only the first ten photos of a listed design', () => {
    const file = legacyCatalogue()
    openDb(file).close()
    const marks = stamped(file)
    for (let i = 0; i < 10; i++) expect(marks.get(100 + i), `photo ${100 + i}`).toBe(true)
    // Eleven and twelve were never attempted, so saying they went up would
    // hide them behind a record that is not true.
    expect(marks.get(110)).toBe(false)
    expect(marks.get(111)).toBe(false)
  })

  it('leaves a photo the push recorded as failed unstamped', () => {
    const file = legacyCatalogue()
    openDb(file).close()
    const marks = stamped(file)
    expect(marks.get(202)).toBe(false)
    expect(marks.get(200)).toBe(true)
    expect(marks.get(203)).toBe(true)
  })

  it('does not let a warning clear a photo that number now belongs to', () => {
    // Design 2 once failed to upload its photo 201. A rebuild later gave that
    // number to design 4, whose photo did reach Etsy. Matching on the number
    // alone would clear it and send a duplicate to a live listing.
    const file = legacyCatalogue()
    openDb(file).close()
    expect(stamped(file).get(201)).toBe(true)
  })

  it('ignores a warning from a design that no longer exists', () => {
    // The history names design 99 and photo 100. Photo 100 belongs to design 1
    // now, and nothing should clear it.
    const file = legacyCatalogue()
    openDb(file).close()
    expect(stamped(file).get(100)).toBe(true)
  })

  it('stamps nothing for a design that was never pushed', () => {
    const file = legacyCatalogue()
    openDb(file).close()
    const marks = stamped(file)
    for (let i = 0; i < 3; i++) expect(marks.get(300 + i), `photo ${300 + i}`).toBe(false)
  })

  it('runs once and does not restamp on reopen', () => {
    const file = legacyCatalogue()
    openDb(file).close()
    const first = stamped(file)
    openDb(file).close()
    expect(stamped(file)).toEqual(first)
  })

  /* The column is the only marker that this ran. If a crash could leave it
     behind with the stamping unfinished, the migration would never be retried
     and the next push would re-send every photo of every listing. */
  it('rolls the column back when the backfill cannot finish', () => {
    const db = new Database(path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-rb-')), 'c.sqlite'))
    db.exec('CREATE TABLE photos (photo_id INTEGER PRIMARY KEY, etsy_uploaded_at_probe TEXT)')
    expect(() =>
      db.transaction(() => {
        db.exec('ALTER TABLE photos ADD COLUMN etsy_uploaded_at TEXT')
        throw new Error('crash after the ALTER')
      })()
    ).toThrow(/crash after the ALTER/)
    const cols = (db.prepare('PRAGMA table_info(photos)').all() as Array<{ name: string }>).map((c) => c.name)
    db.close()
    expect(cols).not.toContain('etsy_uploaded_at')
  })
})
