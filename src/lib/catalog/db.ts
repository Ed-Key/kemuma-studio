import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

export type Db = InstanceType<typeof Database>

export function openDb(file: string): Db {
  mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS designs (
      design_id INTEGER PRIMARY KEY,
      family TEXT NOT NULL,
      name TEXT NOT NULL UNIQUE,
      notes TEXT,
      etsy_listing_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pieces (
      piece_id INTEGER PRIMARY KEY,
      design_id INTEGER NOT NULL REFERENCES designs(design_id),
      colorway TEXT NOT NULL,
      finish TEXT,
      height_in REAL NOT NULL,
      width_in REAL NOT NULL,
      depth_in REAL NOT NULL,
      weight_lb REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      condition_notes TEXT,
      status TEXT NOT NULL DEFAULT 'cataloged'
        CHECK (status IN ('cataloged', 'drafted', 'listed', 'sold')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS photos (
      photo_id INTEGER PRIMARY KEY,
      piece_id INTEGER NOT NULL REFERENCES pieces(piece_id),
      file_path TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS events (
      event_id INTEGER PRIMARY KEY,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drafts (
      draft_id INTEGER PRIMARY KEY,
      design_id INTEGER NOT NULL REFERENCES designs(design_id),
      status TEXT NOT NULL DEFAULT 'generated'
        CHECK (status IN ('generated', 'approved')),
      generated_json TEXT NOT NULL,
      final_json TEXT,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  const draftCols = (db.prepare('PRAGMA table_info(drafts)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!draftCols.includes('usage_json')) {
    db.exec('ALTER TABLE drafts ADD COLUMN usage_json TEXT')
    db.exec('ALTER TABLE drafts ADD COLUMN cost_usd REAL')
  }
}
