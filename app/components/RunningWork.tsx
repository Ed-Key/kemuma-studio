'use client'

import { useEffect, useState } from 'react'
import WorkingOrb, { type OrbState } from './WorkingOrb'

const POLL_MS = 3000
const TICK_MS = 1000

type RunningJob = {
  job_id: number
  kind: string
  design_id: number | null
  status: string
  created_at: string
  started_at: string | null
  narration: string | null
}

function elapsed(job: RunningJob, now: number): string {
  const started = Date.parse(job.started_at ?? job.created_at)
  const seconds = Math.max(0, Math.floor((now - started) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * The work this page started, shown on this page.
 *
 * Enqueue-and-return left the launcher silent: the submit button goes idle the
 * moment the job row is inserted, so the two minutes of actual work passed with
 * the page looking untouched while the rail knew all about it.
 *
 * These pills are not driven by the click. They read the same /api/jobs rows
 * the rail reads, which is what makes them honest: one appears on a page loaded
 * mid-batch, survives a refresh, and clears when the row says the work finished
 * rather than when a timer says so. Both surfaces reading the same rows is why
 * they cannot end up contradicting each other.
 *
 * The launcher's own button stays live beside these. Running several batches at
 * once is a deliberate allowance, so a button that disabled itself for two
 * minutes would quietly take it away, and one pill per batch is the honest
 * answer to how many are going.
 */
export default function RunningWork({
  kind,
  designId,
  label,
  orbState = 'composing',
}: {
  kind: string
  designId: number
  label: string
  orbState?: OrbState
}) {
  const [jobs, setJobs] = useState<RunningJob[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let active = true
    let request: AbortController | null = null

    const poll = async () => {
      request?.abort()
      request = new AbortController()
      try {
        const response = await fetch('/api/jobs', {
          cache: 'no-store',
          signal: request.signal,
        })
        if (!response.ok) return
        const body = (await response.json()) as { jobs: RunningJob[] }
        if (!active) return
        setJobs(
          body.jobs.filter(
            (job) =>
              job.kind === kind
              && job.design_id === designId
              && (job.status === 'running' || job.status === 'queued')
          )
        )
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Could not read running work', error)
        }
      }
    }

    void poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      active = false
      request?.abort()
      clearInterval(timer)
    }
  }, [kind, designId])

  useEffect(() => {
    if (jobs.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [jobs.length])

  if (jobs.length === 0) return null

  // No wrapper: the launcher's own .action-row already lays out a wrapping row
  // of controls, and .orb-pill is the working treatment used everywhere else,
  // so a pill here looks like the one the button shows for its own half second.
  // The job's own account of itself when it has one, the verb when it does not.
  // A batch that has not reached its first real boundary yet has nothing true
  // to say, and "starting" would be filler dressed as information.
  return (
    <>
      {jobs.map((job) => (
        <WorkingOrb
          key={job.job_id}
          label={`${job.narration ?? label} · ${elapsed(job, now)}`}
          state={orbState}
        />
      ))}
    </>
  )
}
