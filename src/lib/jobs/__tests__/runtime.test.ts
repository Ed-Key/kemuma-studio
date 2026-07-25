import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDesign } from '@/lib/catalog/catalog'
import { openDb, type Db } from '@/lib/catalog/db'
import { create, get, markRunning } from '@/lib/catalog/jobs'
import { executeJob } from '@/lib/jobs/executor'
import {
  registerJob,
  runningJobIds,
  unregisterJob,
} from '@/lib/jobs/registry'
import { sweepStaleJobs } from '@/lib/jobs/sweep'

function tempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-runtime-')), 'catalog.sqlite')
}

describe('job runtime', () => {
  let db: Db
  let designId: number

  beforeEach(() => {
    db = openDb(tempDbPath())
    designId = createDesign(db, { family: 'figure', name: 'Leaping Gazelle' })
  })

  afterEach(() => {
    for (const jobId of runningJobIds()) unregisterJob(jobId)
  })

  function queuedJob(kind: 'director_turn' | 'staging_batch' | 'planned_batch' | 'listing_copy' = 'staging_batch') {
    return create(db, {
      kind,
      design_id: designId,
      title: 'Staging · Leaping Gazelle',
      destination: `/designs/${designId}/staging`,
    }, new Date('2026-07-25T12:00:00.000Z'))
  }

  it('marks an orphan interrupted after 90 seconds and leaves a young orphan running', () => {
    const oldJob = queuedJob()
    const youngJob = queuedJob()
    markRunning(db, oldJob, new Date('2026-07-25T12:00:00.000Z'))
    markRunning(db, youngJob, new Date('2026-07-25T12:00:02.000Z'))

    sweepStaleJobs(db, { now: new Date('2026-07-25T12:01:31.000Z') })

    expect(get(db, oldJob)?.status).toBe('interrupted')
    expect(get(db, youngJob)?.status).toBe('running')
  })

  it('aborts and fails a stuck live job after 15 minutes', () => {
    const jobId = queuedJob()
    markRunning(db, jobId, new Date('2026-07-25T12:00:00.000Z'))
    const controller = new AbortController()
    registerJob(jobId, controller)

    sweepStaleJobs(db, { now: new Date('2026-07-25T12:16:00.000Z') })

    expect(controller.signal.aborted).toBe(true)
    expect(get(db, jobId)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/stuck/i),
    })
  })

  it('runs an operation through the shared lifecycle and stores returned usage', async () => {
    const jobId = queuedJob('director_turn')
    let beat: (() => void) | undefined
    let stopCount = 0

    const result = await executeJob(
      db,
      jobId,
      async () => ({
        model: 'claude-opus-4-8',
        input_tokens: 10,
        output_tokens: 5,
        cost_usd: 0.000175,
      }),
      {
        now: () => new Date('2026-07-25T12:00:03.000Z'),
        startHeartbeat: (callback) => {
          beat = callback
          return () => {
            stopCount += 1
          }
        },
      }
    )

    expect(beat).toBeTypeOf('function')
    expect(result).toMatchObject({ model: 'claude-opus-4-8' })
    expect(get(db, jobId)).toMatchObject({
      status: 'done',
      model: 'claude-opus-4-8',
      input_tokens: 10,
      output_tokens: 5,
      cost_usd: 0.000175,
    })
    expect(stopCount).toBe(1)
    expect(runningJobIds()).not.toContain(jobId)
  })

  it('records an operation error and unregisters the job', async () => {
    const jobId = queuedJob('listing_copy')

    await executeJob(
      db,
      jobId,
      async () => {
        throw new Error('writer stopped')
      },
      {
        now: () => new Date('2026-07-25T12:00:03.000Z'),
        startHeartbeat: () => () => {},
      }
    )

    expect(get(db, jobId)).toMatchObject({
      status: 'failed',
      error: 'writer stopped',
    })
    expect(runningJobIds()).not.toContain(jobId)
  })

  it('refreshes the heartbeat while an operation is running', async () => {
    const jobId = queuedJob()
    let beat: (() => void) | undefined
    let finish: (() => void) | undefined
    let now = new Date('2026-07-25T12:00:03.000Z')

    const execution = executeJob(
      db,
      jobId,
      async () => new Promise<void>((resolve) => {
        finish = resolve
      }),
      {
        now: () => now,
        startHeartbeat: (callback) => {
          beat = callback
          return () => {}
        },
      }
    )
    await Promise.resolve()
    now = new Date('2026-07-25T12:00:08.000Z')
    beat?.()

    expect(get(db, jobId)?.heartbeat_at).toBe('2026-07-25T12:00:08.000Z')

    finish?.()
    await execution
  })
})
