import type { Db } from '@/lib/catalog/db'
import {
  listOpen,
  markFailed,
  markInterrupted,
  type JobRecord,
} from '@/lib/catalog/jobs'
import { cancelJob, runningJobIds } from './registry'

const STUCK_MS = 15 * 60 * 1000
const ORPHANED_MS = 90 * 1000

function ageMs(now: Date, timestamp: string): number {
  return now.getTime() - new Date(timestamp).getTime()
}

function runningSince(job: JobRecord): string {
  return job.started_at ?? job.created_at
}

function lastHeartbeat(job: JobRecord): string {
  return job.heartbeat_at ?? job.started_at ?? job.created_at
}

export function sweepStaleJobs(
  db: Db,
  options: { now?: Date } = {}
): void {
  const now = options.now ?? new Date()
  const live = new Set(runningJobIds())
  const runningJobs = listOpen(db).filter((job) => job.status === 'running')

  for (const job of runningJobs) {
    if (live.has(job.job_id)) {
      const runtime = ageMs(now, runningSince(job))
      if (runtime < STUCK_MS) continue
      cancelJob(job.job_id)
      markFailed(
        db,
        job.job_id,
        `Job ${job.job_id} was marked failed as stuck after ${Math.round(runtime / 1000)}s.`,
        now
      )
      continue
    }

    const silence = ageMs(now, lastHeartbeat(job))
    if (silence < ORPHANED_MS) continue
    // Development restarts are routine for the owner. An orphan is interrupted
    // and retryable because a restart is not a failed operation.
    markInterrupted(
      db,
      job.job_id,
      `Job ${job.job_id} was interrupted after ${Math.round(silence / 1000)}s without a live executor.`,
      now
    )
  }
}
