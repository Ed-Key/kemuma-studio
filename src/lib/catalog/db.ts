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
      position INTEGER NOT NULL DEFAULT 0,
      -- Flagged in the garage: the shot that shows the whole piece, which is
      -- what the dimension card needs and what is easy to know while holding it.
      dimension_shot INTEGER NOT NULL DEFAULT 0
    );
    -- Etsy carries one video per listing and a listing is a design, so a
    -- design with several filmed pieces still sends exactly one. Stored per
    -- piece because that is where filming happens; the push picks.
    CREATE TABLE IF NOT EXISTS videos (
      video_id INTEGER PRIMARY KEY,
      piece_id INTEGER NOT NULL REFERENCES pieces(piece_id),
      file_path TEXT NOT NULL,
      etsy_uploaded_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS events (
      event_id INTEGER PRIMARY KEY,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS intakes (
      intake_id INTEGER PRIMARY KEY,
      dir TEXT NOT NULL,
      photos_json TEXT NOT NULL,
      proposal_json TEXT,
      -- Measured at capture, in the garage, with the piece in hand. The only
      -- moment these are cheap to get right rather than estimated later.
      facts_json TEXT,
      videos_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    CREATE TABLE IF NOT EXISTS staged_images (
      staged_id INTEGER PRIMARY KEY,
      design_id INTEGER NOT NULL REFERENCES designs(design_id),
      scene_key TEXT NOT NULL,
      source_photo_id INTEGER NOT NULL REFERENCES photos(photo_id),
      prompt TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'candidate'
        CHECK (status IN ('candidate', 'approved', 'rejected')),
      destination TEXT
        CHECK (destination IN ('social', 'pinterest', 'storefront', 'storyboard')),
      reject_reason TEXT,
      reject_note TEXT,
      prompt_version TEXT,
      plan_json TEXT,
      model TEXT NOT NULL,
      cost_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS dimension_cards (
      card_id INTEGER PRIMARY KEY,
      design_id INTEGER NOT NULL REFERENCES designs(design_id),
      source_photo_id INTEGER NOT NULL REFERENCES photos(photo_id),
      file_path TEXT NOT NULL,
      height_in REAL NOT NULL,
      width_in REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'candidate'
        CHECK (status IN ('candidate', 'approved', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS staging_chats (
      chat_id INTEGER PRIMARY KEY,
      design_id INTEGER NOT NULL UNIQUE REFERENCES designs(design_id),
      messages_json TEXT NOT NULL DEFAULT '[]',
      staging_notes TEXT,
      pending_plan_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS jobs (
      job_id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL
        CHECK (kind IN ('director_turn', 'staging_batch', 'planned_batch', 'listing_copy')),
      design_id INTEGER REFERENCES designs(design_id),
      title TEXT NOT NULL,
      status TEXT NOT NULL
        CHECK (status IN ('queued', 'running', 'done', 'failed', 'interrupted')),
      destination TEXT NOT NULL,
      seen_at TEXT,
      error TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      heartbeat_at TEXT,
      -- The call that started the run, as JSON. Without it a job row records
      -- that work happened but not what was asked for, which makes a retry
      -- impossible and a replay impossible for the same reason.
      input_json TEXT
    );
    CREATE TABLE IF NOT EXISTS job_logs (
      job_id INTEGER NOT NULL REFERENCES jobs(job_id),
      log_type TEXT NOT NULL
        CHECK (log_type IN ('text', 'tool_use', 'tool_result', 'error')),
      tool_name TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
  const draftCols = (db.prepare('PRAGMA table_info(drafts)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!draftCols.includes('usage_json')) {
    db.exec('ALTER TABLE drafts ADD COLUMN usage_json TEXT')
    db.exec('ALTER TABLE drafts ADD COLUMN cost_usd REAL')
  }
  const cardCols = (db.prepare('PRAGMA table_info(dimension_cards)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!cardCols.includes('etsy_uploaded_at')) {
    db.exec('ALTER TABLE dimension_cards ADD COLUMN etsy_uploaded_at TEXT')
  }
  const stagedCols = (db.prepare('PRAGMA table_info(staged_images)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!stagedCols.includes('etsy_uploaded_at')) {
    db.exec('ALTER TABLE staged_images ADD COLUMN etsy_uploaded_at TEXT')
  }
  if (!stagedCols.includes('reject_reason')) {
    db.exec('ALTER TABLE staged_images ADD COLUMN reject_reason TEXT')
  }
  if (!stagedCols.includes('reject_note')) {
    db.exec('ALTER TABLE staged_images ADD COLUMN reject_note TEXT')
  }
  if (!stagedCols.includes('prompt_version')) {
    db.exec('ALTER TABLE staged_images ADD COLUMN prompt_version TEXT')
  }
  // What the director asked for, kept beside what was actually sent. The
  // assembled prompt alone cannot tell you whether a bad image came from a bad
  // plan or from the assembler mangling a good one.
  if (!stagedCols.includes('plan_json')) {
    db.exec('ALTER TABLE staged_images ADD COLUMN plan_json TEXT')
  }
  const designCols = (db.prepare('PRAGMA table_info(designs)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!designCols.includes('published_at')) {
    db.exec('ALTER TABLE designs ADD COLUMN published_at TEXT')
  }
  if (!designCols.includes('push_warnings_json')) {
    db.exec('ALTER TABLE designs ADD COLUMN push_warnings_json TEXT')
  }
  if (!designCols.includes('push_warned_at')) {
    db.exec('ALTER TABLE designs ADD COLUMN push_warned_at TEXT')
  }
  const jobCols = (db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!jobCols.includes('input_json')) {
    db.exec('ALTER TABLE jobs ADD COLUMN input_json TEXT')
  }
  const photoCols = (db.prepare('PRAGMA table_info(photos)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!photoCols.includes('dimension_shot')) {
    db.exec('ALTER TABLE photos ADD COLUMN dimension_shot INTEGER NOT NULL DEFAULT 0')
  }
  /* Which photos actually reached the listing, the same record a staged scene
     has kept all along. Without it nothing could tell a photo that went up from
     one whose upload dropped, so a second push sent none of them and five
     photos across four live listings stayed missing.

     Three things this backfill has to get right, because getting them wrong
     means duplicate images on a shop that takes real money.

     It must assume a photo of an existing listing is already up, or the first
     push after this would re-send nineteen listings' worth. But only the first
     ten, because that is all the old uploader ever attempted; four designs
     carry more than that and those extra photos were never sent, so claiming
     they were would be a lie that hides them forever. The ten is written out
     rather than read from the uploader's cap on purpose: it records what was
     attempted at the time, and it must not move if that cap is ever raised.

     The exceptions are named in the push events, which wrote "image <id>
     failed to upload" into the warnings at the time. Photo ids have been
     reused across catalogue rebuilds, so a warning only clears a photo that
     still belongs to the design the warning was about.

     All of it commits together. The column is the only marker that this ran,
     so a half-finished migration that still left the column behind would never
     be retried and would take the duplicates with it. */
  if (!photoCols.includes('etsy_uploaded_at')) {
    const failures: Array<{ designId: number; photoId: number }> = []
    const pushes = db
      .prepare("SELECT payload FROM events WHERE type = 'etsy.pushed'")
      .all() as Array<{ payload: string }>
    for (const row of pushes) {
      let payload: { design_id?: unknown; warnings?: unknown }
      try {
        payload = JSON.parse(row.payload)
      } catch {
        continue
      }
      const designId = payload.design_id
      if (typeof designId !== 'number' || !Array.isArray(payload.warnings)) continue
      for (const warning of payload.warnings) {
        const hit = /^image (\d+) failed to upload/.exec(String(warning))
        if (hit) failures.push({ designId, photoId: Number(hit[1]) })
      }
    }

    db.transaction(() => {
      db.exec('ALTER TABLE photos ADD COLUMN etsy_uploaded_at TEXT')
      db.exec(`
        UPDATE photos SET etsy_uploaded_at = datetime('now')
        WHERE photo_id IN (
          SELECT photo_id FROM (
            SELECT ph.photo_id,
                   ROW_NUMBER() OVER (PARTITION BY p.design_id ORDER BY p.piece_id, ph.position) AS rn
            FROM pieces p
            JOIN photos ph ON ph.piece_id = p.piece_id
            JOIN designs d ON d.design_id = p.design_id
            WHERE d.etsy_listing_id IS NOT NULL
          ) WHERE rn <= 10
        )
      `)
      const clear = db.prepare(`
        UPDATE photos SET etsy_uploaded_at = NULL
        WHERE photo_id = ?
          AND piece_id IN (SELECT piece_id FROM pieces WHERE design_id = ?)
      `)
      for (const f of failures) clear.run(f.photoId, f.designId)
    })()
  }
  const intakeCols = (db.prepare('PRAGMA table_info(intakes)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!intakeCols.includes('facts_json')) {
    db.exec('ALTER TABLE intakes ADD COLUMN facts_json TEXT')
  }
  if (!intakeCols.includes('videos_json')) {
    db.exec('ALTER TABLE intakes ADD COLUMN videos_json TEXT')
  }
}
