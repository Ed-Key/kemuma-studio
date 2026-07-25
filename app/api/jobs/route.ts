import { getCatalogDb } from '@/lib/catalog/instance'
import { listOpen } from '@/lib/catalog/jobs'
import { sweepStaleJobs } from '@/lib/jobs/sweep'

export const dynamic = 'force-dynamic'

export function GET() {
  const db = getCatalogDb()
  sweepStaleJobs(db)
  return Response.json(
    { jobs: listOpen(db) },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
