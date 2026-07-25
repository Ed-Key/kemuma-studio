import type { Db } from '@/lib/catalog/db'
import {
  appendLog,
  get,
  heartbeat,
  markDone,
  markFailed,
  markRunning,
  type JobUsage,
} from '@/lib/catalog/jobs'
import { registerJob, unregisterJob } from './registry'

const HEARTBEAT_MS = 5_000

type StopHeartbeat = () => void
type StartHeartbeat = (callback: () => void) => StopHeartbeat

interface ExecutorOptions {
  now?: () => Date
  startHeartbeat?: StartHeartbeat
}

function defaultHeartbeat(callback: () => void): StopHeartbeat {
  const timer = setInterval(callback, HEARTBEAT_MS)
  timer.unref()
  return () => clearInterval(timer)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function returnedUsage(result: unknown): JobUsage | undefined {
  if (!result || typeof result !== 'object') return undefined
  const value = result as Record<string, unknown>
  const usage: JobUsage = {}
  if (typeof value.model === 'string' || value.model === null) usage.model = value.model
  if (typeof value.input_tokens === 'number' || value.input_tokens === null) {
    usage.input_tokens = value.input_tokens
  }
  if (typeof value.output_tokens === 'number' || value.output_tokens === null) {
    usage.output_tokens = value.output_tokens
  }
  if (typeof value.cost_usd === 'number' || value.cost_usd === null) {
    usage.cost_usd = value.cost_usd
  }
  return Object.keys(usage).length > 0 ? usage : undefined
}

export async function executeJob<T>(
  db: Db,
  jobId: number,
  operation: (signal: AbortSignal) => Promise<T>,
  options: ExecutorOptions = {}
): Promise<T | undefined> {
  const now = options.now ?? (() => new Date())
  const controller = registerJob(jobId)
  let stopHeartbeat: StopHeartbeat = () => {}

  try {
    markRunning(db, jobId, now())
    const startHeartbeat = options.startHeartbeat ?? defaultHeartbeat
    stopHeartbeat = startHeartbeat(() => heartbeat(db, jobId, now()))
    const result = await operation(controller.signal)

    // The stale sweep may have failed and aborted this job while an operation
    // that does not support AbortSignal was still unwinding.
    if (!controller.signal.aborted && get(db, jobId)?.status === 'running') {
      markDone(db, jobId, returnedUsage(result), now())
    }
    return result
  } catch (error) {
    const message = errorText(error)
    if (get(db, jobId)?.status === 'running') {
      markFailed(db, jobId, message, now())
    }
    appendLog(db, {
      job_id: jobId,
      log_type: 'error',
      content: message,
    }, now())
    return undefined
  } finally {
    stopHeartbeat()
    unregisterJob(jobId)
  }
}
