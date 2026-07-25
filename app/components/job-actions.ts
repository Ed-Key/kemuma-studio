'use server'

import { revalidatePath } from 'next/cache'
import { getCatalogDb } from '@/lib/catalog/instance'
import { get as getJob, markSeen } from '@/lib/catalog/jobs'
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
