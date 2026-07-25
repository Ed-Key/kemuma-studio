'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { JobMark } from './JobMark'

/* The rail shows itself once on load, then gets out of the way. Leaving it
   waits a beat so a pointer that clips the corner on its way past does not snap
   it shut mid-reach. */
const IDLE_MS = 2600
const GRACE_MS = 450
const JOB_POLL_MS = 3000
const ELAPSED_TICK_MS = 1000

type RailJob = {
  job_id: number
  title: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'interrupted'
  destination: string
  created_at: string
  started_at: string | null
  finished_at: string | null
}

function isTerminal(status: RailJob['status']): boolean {
  return status !== 'queued' && status !== 'running'
}

const NAV = [
  {
    href: '/designs',
    label: 'Catalog',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    href: '/intake',
    label: 'Intake',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M4 20h16" />
      </svg>
    ),
  },
  {
    href: '/marketing',
    label: 'Marketing',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="3" y="4" width="18" height="15" />
        <circle cx="8.5" cy="9.5" r="1.6" />
        <path d="m4 17 5-5 4 4 3-2 4 4" />
      </svg>
    ),
  },
]

/** Read in the layout, which is a server component; the rail owns the collapse
 *  timers so it has to be a client component and cannot query the db itself. */
export type NavCounts = Record<string, number>

function formatElapsed(job: RailJob, now: number): string {
  const started = Date.parse(job.started_at ?? job.created_at)
  const finished = job.finished_at ? Date.parse(job.finished_at) : now
  const totalSeconds = Math.max(0, Math.floor((finished - started) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

export default function Sidebar({ counts }: { counts?: NavCounts }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [jobs, setJobs] = useState<RailJob[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [settling, setSettling] = useState<ReadonlySet<number>>(() => new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /* Lives in a ref, not state, so it survives the rail swapping between its
     collapsed and open branches without replaying anything. */
  const lastStatus = useRef(new Map<number, RailJob['status']>())

  const arm = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCollapsed(true), ms)
  }, [])

  const open = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setCollapsed(false)
  }, [])

  useEffect(() => {
    arm(IDLE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [arm])

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
        const body = await response.json() as { jobs: RailJob[] }
        if (active) setJobs(body.jobs)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Could not read jobs', error)
        }
      }
    }

    void poll()
    const pollTimer = setInterval(poll, JOB_POLL_MS)
    return () => {
      active = false
      request?.abort()
      clearInterval(pollTimer)
    }
  }, [])

  useEffect(() => {
    const elapsedTimer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS)
    return () => clearInterval(elapsedTimer)
  }, [])

  /* The fold from sphere to shape is the one piece of motion in the rail that
     is not "still running", so it has to mean a job actually landed just now.
     A job already finished when the page loaded gets its resting shape with no
     animation, and a poll that changes nothing animates nothing. */
  useEffect(() => {
    const before = lastStatus.current
    const landed = jobs
      .filter((job) => {
        const was = before.get(job.job_id)
        return was != null && !isTerminal(was) && isTerminal(job.status)
      })
      .map((job) => job.job_id)

    const present = new Set(jobs.map((job) => job.job_id))
    for (const id of before.keys()) if (!present.has(id)) before.delete(id)
    for (const job of jobs) before.set(job.job_id, job.status)

    if (landed.length > 0) setSettling((current) => new Set([...current, ...landed]))
  }, [jobs])

  const settled = useCallback((jobId: number) => {
    setSettling((current) => {
      if (!current.has(jobId)) return current
      const next = new Set(current)
      next.delete(jobId)
      return next
    })
  }, [])

  return (
    <div className="rail">
      {/* onFocus/onBlur are React's focusin/focusout, so they fire for anything
          inside the rail: tabbing in opens it, tabbing out closes it on the
          same grace the pointer gets. */}
      <aside
        className="sidebar"
        data-collapsed={collapsed}
        onMouseEnter={open}
        onMouseLeave={() => arm(GRACE_MS)}
        onFocus={open}
        onBlur={() => arm(GRACE_MS)}
      >
        <Link href="/designs" className="brand" aria-label="Kemuma Carvings">
          <span className="crest">
            <img src="/brand/shop-logo.jpg" alt="" width={38} height={38} />
          </span>
          <span className="wordmark">
            Kemuma
            <small>Carvings</small>
          </span>
        </Link>
        <div className="origin">
          <img src="/brand/flag-ke.svg" alt="Kenya" width={15} height={15} />
          <span>Tabaka, Kisii</span>
        </div>
        <nav className="nav">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                /* The visible label folds to zero width when the rail closes,
                   so the accessible name cannot come from it. */
                aria-label={item.label}
              >
                {item.icon}
                <span className="nav-label">{item.label}</span>
                {counts?.[item.href] != null && (
                  /* Folds away with the label when the rail closes, so the
                     collapsed rail stays a clean column of glyphs. */
                  <span className="nav-count">{counts[item.href]}</span>
                )}
              </Link>
            )
          })}
        </nav>
        {collapsed && jobs.length > 0 && (
          /* Newest first, so the thing just started is nearest the nav the eye
             already came from. Names wait for hover; nothing but marks here. */
          <section className="rail-marks" aria-label={`${jobs.length} jobs`}>
            {/* Not links, though the plan asked for them to be. A pointer
                cannot reach a collapsed mark: approaching it opens the rail,
                which swaps this whole section for the rows below, so the mark
                is gone before a click can land. Keyboard is worse, since focus
                opens the rail too and the focused element unmounts under it. A
                link that can never fire is an affordance that lies, so the
                marks stay a summary and the rows carry the navigation. */}
            {jobs.map((job) => (
              <JobMark
                key={job.job_id}
                status={job.status}
                settle={settling.has(job.job_id)}
                onSettled={() => settled(job.job_id)}
              />
            ))}
          </section>
        )}
        {!collapsed && jobs.length > 0 && (
          <section className="rail-jobs" aria-label="Jobs">
            {jobs.map((job) => (
              <Link className="rail-job" key={job.job_id} href={job.destination}>
                <div className="rail-job-head">
                  <JobMark
                    status={job.status}
                    settle={settling.has(job.job_id)}
                    onSettled={() => settled(job.job_id)}
                  />
                  <span className="rail-job-title">{job.title}</span>
                </div>
                <div className="rail-job-meta">
                  <time className="rail-job-elapsed">
                    {formatElapsed(job, now)}
                  </time>
                  <span className={`rail-job-status rail-job-status--${job.status}`}>
                    {job.status}
                  </span>
                </div>
              </Link>
            ))}
          </section>
        )}
      </aside>
    </div>
  )
}
