import type { Db } from './db'

export const JOB_KINDS = [
  'director_turn',
  'staging_batch',
  'planned_batch',
  'listing_copy',
] as const
export type JobKind = (typeof JOB_KINDS)[number]

export const JOB_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'interrupted',
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export type JobLogType = 'text' | 'tool_use' | 'tool_result' | 'error'

export interface JobRecord {
  job_id: number
  kind: JobKind
  design_id: number | null
  title: string
  status: JobStatus
  destination: string
  seen_at: string | null
  error: string | null
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  heartbeat_at: string | null
  /** The call that started the run, as JSON. Null for rows written before
   *  jobs recorded their inputs, which is what makes them unretryable. */
  input_json: string | null
}

export interface JobUsage {
  model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  cost_usd?: number | null
}

function timestamp(now: Date): string {
  return now.toISOString()
}

export function create(
  db: Db,
  input: {
    kind: JobKind
    design_id?: number | null
    title: string
    destination: string
    /** The arguments the executor was handed, so the run can be repeated. */
    input?: unknown
  },
  now = new Date()
): number {
  const result = db
    .prepare(`
      INSERT INTO jobs (kind, design_id, title, status, destination, created_at, input_json)
      VALUES (?, ?, ?, 'queued', ?, ?, ?)
    `)
    .run(
      input.kind,
      input.design_id ?? null,
      input.title,
      input.destination,
      timestamp(now),
      input.input === undefined ? null : JSON.stringify(input.input)
    )
  return Number(result.lastInsertRowid)
}

export function markRunning(db: Db, jobId: number, now = new Date()): void {
  const at = timestamp(now)
  db.prepare(`
    UPDATE jobs
    SET status = 'running', started_at = ?, heartbeat_at = ?, finished_at = NULL, error = NULL
    WHERE job_id = ?
  `).run(at, at, jobId)
}

export function heartbeat(db: Db, jobId: number, now = new Date()): void {
  db.prepare(`
    UPDATE jobs SET heartbeat_at = ?
    WHERE job_id = ? AND status = 'running'
  `).run(timestamp(now), jobId)
}

export function markDone(
  db: Db,
  jobId: number,
  usage?: JobUsage,
  now = new Date()
): void {
  db.prepare(`
    UPDATE jobs
    SET status = 'done', finished_at = ?, error = NULL,
        model = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?
    WHERE job_id = ?
  `).run(
    timestamp(now),
    usage?.model ?? null,
    usage?.input_tokens ?? null,
    usage?.output_tokens ?? null,
    usage?.cost_usd ?? null,
    jobId
  )
}

export function markFailed(
  db: Db,
  jobId: number,
  error: string,
  now = new Date()
): void {
  db.prepare(`
    UPDATE jobs
    SET status = 'failed', error = ?, finished_at = ?
    WHERE job_id = ?
  `).run(error, timestamp(now), jobId)
}

export function markInterrupted(
  db: Db,
  jobId: number,
  error: string | null = null,
  now = new Date()
): void {
  db.prepare(`
    UPDATE jobs
    SET status = 'interrupted', error = ?, finished_at = ?
    WHERE job_id = ?
  `).run(error, timestamp(now), jobId)
}

export function listOpen(db: Db): JobRecord[] {
  return db
    .prepare(`
      SELECT * FROM jobs
      WHERE status IN ('queued', 'running')
         OR (status IN ('done', 'failed', 'interrupted') AND seen_at IS NULL)
      ORDER BY created_at DESC, job_id DESC
    `)
    .all() as JobRecord[]
}

/** Everything still open that landed on one page, oldest first. */
export function listOpenForDestination(db: Db, destination: string): JobRecord[] {
  return db
    .prepare(`
      SELECT * FROM jobs
      WHERE destination = ?
        AND seen_at IS NULL
        AND status IN ('done', 'failed', 'interrupted')
      ORDER BY created_at ASC, job_id ASC
    `)
    .all(destination) as JobRecord[]
}

/**
 * Acknowledge a finished job, which is what takes it out of the rail.
 *
 * Only a finished job can be acknowledged: a running one has nothing to have
 * been seen yet, and stamping it would make the rail forget work still in
 * flight. The `seen_at IS NULL` guard keeps the first arrival the honest one,
 * so a page the owner returns to later does not rewrite when they found out.
 */
export function markSeen(db: Db, jobId: number, now = new Date()): void {
  db.prepare(`
    UPDATE jobs SET seen_at = ?
    WHERE job_id = ?
      AND seen_at IS NULL
      AND status IN ('done', 'failed', 'interrupted')
  `).run(timestamp(now), jobId)
}

export function get(db: Db, jobId: number): JobRecord | null {
  const row = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as
    | JobRecord
    | undefined
  return row ?? null
}

/**
 * The last thing each of these jobs said it was doing.
 *
 * Only 'tool_use' rows, which is what marks a line as written for the owner
 * rather than kept for replay. Returned as a map so the rail can ask about
 * every open job in one query instead of one per row.
 */
export function latestNarration(db: Db, jobIds: number[]): Map<number, string> {
  if (jobIds.length === 0) return new Map()
  const holes = jobIds.map(() => '?').join(', ')
  const rows = db
    .prepare(`
      SELECT job_id, content FROM job_logs
      WHERE rowid IN (
        SELECT MAX(rowid) FROM job_logs
        WHERE job_id IN (${holes}) AND log_type = 'tool_use'
        GROUP BY job_id
      )
    `)
    .all(...jobIds) as Array<{ job_id: number; content: string }>
  return new Map(rows.map((row) => [row.job_id, row.content]))
}

/** How many times this job has already called a given tool. */
export function countToolCalls(db: Db, jobId: number, toolName: string): number {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS n FROM job_logs
      WHERE job_id = ? AND log_type = 'tool_use' AND tool_name = ?
    `)
    .get(jobId, toolName) as { n: number }
  return row.n
}

export function appendLog(
  db: Db,
  input: {
    job_id: number
    log_type: JobLogType
    tool_name?: string | null
    content: string
  },
  now = new Date()
): void {
  db.prepare(`
    INSERT INTO job_logs (job_id, log_type, tool_name, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    input.job_id,
    input.log_type,
    input.tool_name ?? null,
    input.content.slice(0, 2000),
    timestamp(now)
  )
}
