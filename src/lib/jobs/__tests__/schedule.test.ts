import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDesign } from '@/lib/catalog/catalog'
import { openDb, type Db } from '@/lib/catalog/db'
import { create, get } from '@/lib/catalog/jobs'

const afterState = vi.hoisted(() => ({
  callback: undefined as (() => Promise<unknown>) | undefined,
}))

vi.mock('next/server', () => ({
  after: (callback: () => Promise<unknown>) => {
    afterState.callback = callback
  },
}))

import { startJob } from '@/lib/jobs/schedule'

describe('startJob', () => {
  let db: Db
  let jobId: number

  beforeEach(() => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-schedule-')), 'catalog.sqlite')
    db = openDb(file)
    const designId = createDesign(db, { family: 'figure', name: 'Leaping Gazelle' })
    jobId = create(db, {
      kind: 'listing_copy',
      design_id: designId,
      title: 'Listing copy · Leaping Gazelle',
      destination: `/designs/${designId}/draft`,
    }, new Date('2026-07-25T12:00:00.000Z'))
    afterState.callback = undefined
  })

  it('defers the executor to the post-response callback', async () => {
    let operated = false

    startJob(db, jobId, async () => {
      operated = true
      return undefined
    })

    expect(operated).toBe(false)
    expect(get(db, jobId)?.status).toBe('queued')

    await afterState.callback?.()

    expect(operated).toBe(true)
    expect(get(db, jobId)?.status).toBe('done')
  })
})
