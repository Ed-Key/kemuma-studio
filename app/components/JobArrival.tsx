import { after } from 'next/server'
import { getCatalogDb } from '@/lib/catalog/instance'
import { listOpenForDestination, markSeen, type JobRecord } from '@/lib/catalog/jobs'
import ActionForm from './ActionForm'
import PendingSubmit from './PendingSubmit'
import { acknowledgeJobAction } from './job-actions'

/**
 * What happens when the owner reaches the page a job landed on.
 *
 * The rail is an inbox, not a monitor: a finished job sits in it until it is
 * acknowledged. This is where that acknowledgement is decided, and it is
 * deliberately not the click. Clicking a mark is a promise to arrive; the page
 * rendering is arrival. Reaching a page by ordinary navigation clears its jobs
 * the same way, because from the rail's point of view nothing distinguishes
 * the two, and a job whose result the owner is looking at has been seen
 * however they got there.
 *
 * Success and trouble part company here. A finished batch puts its scenes on
 * the page above this line, so arriving is proof of seeing it and the mark
 * clears itself. A failure does not: a push that wrote three attributes and
 * choked on the fourth leaves a page that looks almost right, and clearing
 * that on arrival would be the rail claiming the owner knows something they do
 * not. So trouble states say so here and wait to be dismissed.
 */
export default function JobArrival({ destination }: { destination: string }) {
  const db = getCatalogDb()
  const open = listOpenForDestination(db, destination)
  const landed = open.filter((job) => job.status === 'done')
  const trouble = open.filter((job) => job.status !== 'done')

  if (landed.length > 0) {
    // after() so the acknowledgement rides behind the response instead of
    // holding the page the owner came here to read.
    after(() => {
      const write = getCatalogDb()
      for (const job of landed) markSeen(write, job.job_id)
    })
  }

  if (trouble.length === 0) return null

  return (
    <section className="job-arrival" aria-label="Jobs that need a look">
      {trouble.map((job) => (
        <TroubleNotice key={job.job_id} job={job} />
      ))}
    </section>
  )
}

function TroubleNotice({ job }: { job: JobRecord }) {
  const interrupted = job.status === 'interrupted'
  return (
    <div className={`banner banner--${interrupted ? 'warn' : 'danger'} job-notice`}>
      <div>
        <span className="job-notice-title">{job.title}</span>
        <span className="banner-detail">
          {interrupted
            ? 'The server restarted while this was running. Whatever it finished before that is already on this page.'
            : job.error || 'It stopped without saying why.'}
        </span>
      </div>
      <ActionForm action={acknowledgeJobAction}>
        <input type="hidden" name="job_id" value={job.job_id} />
        <PendingSubmit pendingLabel="Clearing..." variant="ghost">
          Clear
        </PendingSubmit>
      </ActionForm>
    </div>
  )
}
