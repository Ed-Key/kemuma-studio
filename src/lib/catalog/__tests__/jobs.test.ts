import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDesign } from '@/lib/catalog/catalog'
import { openDb, type Db } from '@/lib/catalog/db'
import {
  appendLog,
  create,
  get,
  listOpen,
  listOpenForDestination,
  markDone,
  markFailed,
  markRunning,
  markSeen,
} from '@/lib/catalog/jobs'

function tempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-jobs-')), 'catalog.sqlite')
}

describe('jobs', () => {
  let db: Db
  let designId: number

  beforeEach(() => {
    db = openDb(tempDbPath())
    designId = createDesign(db, { family: 'figure', name: 'Leaping Gazelle' })
  })

  it('moves a job from queued to running to done with usage', () => {
    const createdAt = new Date('2026-07-25T12:00:00.000Z')
    const startedAt = new Date('2026-07-25T12:00:03.000Z')
    const finishedAt = new Date('2026-07-25T12:00:09.000Z')
    const jobId = create(db, {
      kind: 'director_turn',
      design_id: designId,
      title: 'Director · Leaping Gazelle',
      destination: `/designs/${designId}/staging`,
    }, createdAt)

    expect(get(db, jobId)).toMatchObject({
      job_id: jobId,
      status: 'queued',
      created_at: createdAt.toISOString(),
    })

    markRunning(db, jobId, startedAt)
    expect(get(db, jobId)).toMatchObject({
      status: 'running',
      started_at: startedAt.toISOString(),
      heartbeat_at: startedAt.toISOString(),
    })

    markDone(db, jobId, {
      model: 'claude-opus-4-8',
      input_tokens: 120,
      output_tokens: 45,
      cost_usd: 0.001725,
    }, finishedAt)
    expect(get(db, jobId)).toMatchObject({
      status: 'done',
      model: 'claude-opus-4-8',
      input_tokens: 120,
      output_tokens: 45,
      cost_usd: 0.001725,
      finished_at: finishedAt.toISOString(),
      error: null,
    })
  })

  it('records a failure error', () => {
    const jobId = create(db, {
      kind: 'listing_copy',
      design_id: designId,
      title: 'Listing copy · Leaping Gazelle',
      destination: `/designs/${designId}/draft`,
    }, new Date('2026-07-25T12:00:00.000Z'))

    markRunning(db, jobId, new Date('2026-07-25T12:00:01.000Z'))
    markFailed(db, jobId, 'writer returned invalid copy', new Date('2026-07-25T12:00:02.000Z'))

    expect(get(db, jobId)).toMatchObject({
      status: 'failed',
      error: 'writer returned invalid copy',
      finished_at: '2026-07-25T12:00:02.000Z',
    })
  })

  it('excludes finished jobs after they have been seen', () => {
    const unseen = create(db, {
      kind: 'staging_batch',
      design_id: designId,
      title: 'Staging · Leaping Gazelle',
      destination: `/designs/${designId}/staging`,
    }, new Date('2026-07-25T12:00:00.000Z'))
    const seen = create(db, {
      kind: 'planned_batch',
      design_id: designId,
      title: 'Planned batch · Leaping Gazelle',
      destination: `/designs/${designId}/staging`,
    }, new Date('2026-07-25T12:00:01.000Z'))
    markDone(db, unseen, undefined, new Date('2026-07-25T12:01:00.000Z'))
    markDone(db, seen, undefined, new Date('2026-07-25T12:01:00.000Z'))
    db.prepare('UPDATE jobs SET seen_at = ? WHERE job_id = ?').run('2026-07-25T12:02:00.000Z', seen)

    expect(listOpen(db).map((job) => job.job_id)).toEqual([unseen])
  })

  it('lists only the unseen finished jobs that landed on one page', () => {
    const here = create(db, {
      kind: 'staging_batch',
      design_id: designId,
      title: 'Staging · Leaping Gazelle',
      destination: `/designs/${designId}/staging`,
    }, new Date('2026-07-25T12:00:00.000Z'))
    const elsewhere = create(db, {
      kind: 'listing_copy',
      design_id: designId,
      title: 'Listing copy · Leaping Gazelle',
      destination: `/designs/${designId}/draft`,
    }, new Date('2026-07-25T12:00:01.000Z'))
    const stillRunning = create(db, {
      kind: 'planned_batch',
      design_id: designId,
      title: 'Planned batch · Leaping Gazelle',
      destination: `/designs/${designId}/staging`,
    }, new Date('2026-07-25T12:00:02.000Z'))
    markDone(db, here, undefined, new Date('2026-07-25T12:01:00.000Z'))
    markDone(db, elsewhere, undefined, new Date('2026-07-25T12:01:00.000Z'))
    markRunning(db, stillRunning, new Date('2026-07-25T12:01:00.000Z'))

    const open = listOpenForDestination(db, `/designs/${designId}/staging`)
    expect(open.map((job) => job.job_id)).toEqual([here])
  })

  it('acknowledges a finished job once and keeps the first arrival', () => {
    const jobId = create(db, {
      kind: 'staging_batch',
      design_id: designId,
      title: 'Staging · Leaping Gazelle',
      destination: `/designs/${designId}/staging`,
    }, new Date('2026-07-25T12:00:00.000Z'))
    markDone(db, jobId, undefined, new Date('2026-07-25T12:01:00.000Z'))

    markSeen(db, jobId, new Date('2026-07-25T12:02:00.000Z'))
    markSeen(db, jobId, new Date('2026-07-25T12:09:00.000Z'))

    expect(get(db, jobId)?.seen_at).toBe('2026-07-25T12:02:00.000Z')
    expect(listOpen(db)).toHaveLength(0)
  })

  it('refuses to acknowledge a job that is still running', () => {
    const jobId = create(db, {
      kind: 'director_turn',
      design_id: designId,
      title: 'Director · Leaping Gazelle',
      destination: `/designs/${designId}/staging`,
    }, new Date('2026-07-25T12:00:00.000Z'))
    markRunning(db, jobId, new Date('2026-07-25T12:00:01.000Z'))

    markSeen(db, jobId, new Date('2026-07-25T12:00:02.000Z'))

    expect(get(db, jobId)?.seen_at).toBeNull()
    expect(listOpen(db).map((job) => job.job_id)).toEqual([jobId])
  })

  it('truncates appended log content to 2000 characters', () => {
    const jobId = create(db, {
      kind: 'director_turn',
      design_id: designId,
      title: 'Director · Leaping Gazelle',
      destination: `/designs/${designId}/staging`,
    }, new Date('2026-07-25T12:00:00.000Z'))

    appendLog(db, {
      job_id: jobId,
      log_type: 'text',
      tool_name: null,
      content: 'x'.repeat(2100),
    }, new Date('2026-07-25T12:00:05.000Z'))

    const row = db.prepare('SELECT * FROM job_logs WHERE job_id = ?').get(jobId) as {
      content: string
      created_at: string
    }
    expect(row.content).toHaveLength(2000)
    expect(row.created_at).toBe('2026-07-25T12:00:05.000Z')
  })
})
