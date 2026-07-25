import { after } from 'next/server'
import type { Db } from '@/lib/catalog/db'
import { executeJob } from './executor'

export function startJob<T>(
  db: Db,
  jobId: number,
  operation: (signal: AbortSignal) => Promise<T>
): void {
  after(() => executeJob(db, jobId, operation))
}
