import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, listEvents } from '@/lib/catalog/catalog'
import { createDraft, latestDraftForDesign, approveDraft } from '@/lib/catalog/drafts'

describe('drafts', () => {
  let db: Db
  let designId: number
  beforeEach(() => {
    db = openDb(path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-drafts-')), 'c.sqlite'))
    designId = createDesign(db, { family: 'coaster set', name: 'Etched Coaster Set' })
  })

  it('creates and fetches the latest draft', () => {
    createDraft(db, { design_id: designId, generated_json: '{"title":"old"}', model: 'm' })
    const newer = createDraft(db, { design_id: designId, generated_json: '{"title":"new"}', model: 'm' })
    const latest = latestDraftForDesign(db, designId)
    expect(latest?.draft_id).toBe(newer)
    expect(latest?.status).toBe('generated')
    expect(JSON.parse(latest!.generated_json).title).toBe('new')
  })

  it('returns null when a design has no drafts', () => {
    expect(latestDraftForDesign(db, designId)).toBeNull()
  })

  it('approves with final json and logs edited fields', () => {
    const id = createDraft(db, { design_id: designId, generated_json: '{"title":"a"}', model: 'm' })
    approveDraft(db, { draft_id: id, final_json: '{"title":"b"}', edited_fields: ['title'] })
    const latest = latestDraftForDesign(db, designId)
    expect(latest?.status).toBe('approved')
    expect(latest?.final_json).toBe('{"title":"b"}')
    const ev = listEvents(db).find((e) => e.type === 'draft.approved')!
    expect(JSON.parse(ev.payload).edited_fields).toEqual(['title'])
  })
})
