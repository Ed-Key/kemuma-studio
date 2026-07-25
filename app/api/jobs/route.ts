import { getCatalogDb } from '@/lib/catalog/instance'
import { latestNarration, listOpen } from '@/lib/catalog/jobs'
import { sweepStaleJobs } from '@/lib/jobs/sweep'

export const dynamic = 'force-dynamic'

export function GET() {
  const db = getCatalogDb()
  sweepStaleJobs(db)
  const jobs = listOpen(db)
  // Only what is still going. A finished job's last line is "generating four
  // scenes", which read on a done row would say it is still generating them.
  const running = jobs.filter((job) => job.status === 'running')
  const narration = latestNarration(db, running.map((job) => job.job_id))
  return Response.json(
    {
      jobs: jobs.map((job) => ({ ...job, narration: narration.get(job.job_id) ?? null })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
