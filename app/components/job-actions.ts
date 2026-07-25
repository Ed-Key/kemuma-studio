'use server'

import { revalidatePath } from 'next/cache'
import { getCatalogDb } from '@/lib/catalog/instance'
import { create as createJob, get as getJob, markSeen } from '@/lib/catalog/jobs'
import { parseJobInput, runJobOperation } from '@/lib/jobs/operations'
import { startJob } from '@/lib/jobs/schedule'
import type { ActionResult } from './action-result'

/**
 * Acknowledge a job by hand.
 *
 * A success acknowledges itself: reaching the page it landed on is proof the
 * owner saw the result, because the result is what the page renders. Trouble
 * cannot claim that. A half-finished batch leaves most of the page looking
 * exactly as it should, so arriving is not proof of noticing, and a failed or
 * interrupted job stays in the rail until this is called.
 */
export async function acknowledgeJobAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const jobId = Number(formData.get('job_id'))
    if (!Number.isInteger(jobId) || jobId < 1) throw new Error('invalid job')
    const db = getCatalogDb()
    const job = getJob(db, jobId)
    if (!job) throw new Error(`job ${jobId} not found`)
    markSeen(db, jobId)
    revalidatePath(job.destination)
    return { ok: true, message: 'Cleared from the rail.' }
  } catch (err) {
    return {
      ok: false,
      message: 'Could not clear the job.',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Run an interrupted job's work again.
 *
 * Retry is offered for interruptions and nothing else. An interruption is the
 * server going away mid-run, which says nothing about whether the work would
 * have succeeded, so repeating it is the obvious answer. A failure already
 * carries a reason, and re-running without addressing that reason only pays
 * for the same error twice; the button that started it is on this page anyway.
 *
 * The retry is a new job rather than the old row restarted. The first attempt
 * is a real thing that happened and its record is worth keeping, especially
 * for the batches, where whatever it produced before dying is still on the
 * page. The old row is acknowledged as part of the retry, so the rail shows
 * one live job instead of an interruption and its answer sitting side by side.
 */
export async function retryJobAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const jobId = Number(formData.get('job_id'))
    if (!Number.isInteger(jobId) || jobId < 1) throw new Error('invalid job')
    const db = getCatalogDb()
    const job = getJob(db, jobId)
    if (!job) throw new Error(`job ${jobId} not found`)
    if (job.status !== 'interrupted') {
      throw new Error(`only an interrupted job can be retried, and this one is ${job.status}`)
    }
    const input = parseJobInput(job.kind, job.input_json)
    if (!input) {
      throw new Error('this job did not record what it was asked to do, so it cannot be repeated')
    }

    const retryId = createJob(db, {
      kind: job.kind,
      design_id: job.design_id,
      title: job.title,
      destination: job.destination,
      input,
    })
    markSeen(db, jobId)
    startJob(db, retryId, () => runJobOperation(db, input))
    revalidatePath(job.destination)
    return { ok: true, message: 'Running it again in the rail.', jobId: retryId }
  } catch (err) {
    return {
      ok: false,
      message: 'Could not run it again.',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
