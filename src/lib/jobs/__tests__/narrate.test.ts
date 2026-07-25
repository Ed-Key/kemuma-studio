import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDesign } from '@/lib/catalog/catalog'
import { openDb, type Db } from '@/lib/catalog/db'
import { create, latestNarration } from '@/lib/catalog/jobs'
import { describeStep, narrator } from '@/lib/jobs/narrate'

describe('describeStep', () => {
  it('names the photos the director is looking at', () => {
    expect(
      describeStep({ kind: 'tool', name: 'view_photos', input: { photo_ids: [45, 46, 47] } })
    ).toBe('looking at photos 45, 46, 47')
  })

  it('falls back when a tool call carries no readable arguments', () => {
    expect(describeStep({ kind: 'tool', name: 'view_photos', input: {} })).toBe(
      'looking at the photos'
    )
    expect(describeStep({ kind: 'tool', name: 'view_photos', input: null })).toBe(
      'looking at the photos'
    )
  })

  it('says nothing about a tool it has no words for', () => {
    // Better the elapsed timer alone than a raw tool name the owner cannot read.
    expect(describeStep({ kind: 'tool', name: 'some_new_tool', input: {} })).toBeNull()
  })

  it('keeps the agent prose out of the status line', () => {
    expect(describeStep({ kind: 'say', text: 'I will stage this on the oak table.' })).toBeNull()
  })

  it('says a repeated plan call is a rejection, because that is what it is', () => {
    const plan = { kind: 'tool' as const, name: 'plan_batch', input: {} }
    expect(describeStep(plan, 0)).toBe('writing the plan')
    expect(describeStep(plan, 1)).toBe('the plan was rejected, writing it again')
    expect(describeStep(plan, 3)).toBe('the plan was rejected 3 times, writing it again')
  })

  it('passes a phase through as written', () => {
    expect(describeStep({ kind: 'phase', text: 'generating 4 scenes' })).toBe('generating 4 scenes')
    expect(describeStep({ kind: 'phase', text: '   ' })).toBeNull()
  })
})

describe('narrator', () => {
  let db: Db
  let jobId: number

  beforeEach(() => {
    db = openDb(path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-narrate-')), 'catalog.sqlite'))
    const designId = createDesign(db, { family: 'figure', name: 'Leaping Gazelle' })
    jobId = create(db, {
      kind: 'director_turn',
      design_id: designId,
      title: 'Director · Leaping Gazelle',
      destination: `/designs/${designId}/staging`,
    })
  })

  it('reports the most recent thing the job did', () => {
    const say = narrator(db, jobId)
    say({ kind: 'tool', name: 'view_design', input: {} })
    say({ kind: 'tool', name: 'view_photos', input: { photo_ids: [45] } })

    expect(latestNarration(db, [jobId]).get(jobId)).toBe('looking at photos 45')
  })

  it('stores the agent prose without ever showing it', () => {
    const say = narrator(db, jobId)
    say({ kind: 'tool', name: 'view_design', input: {} })
    say({ kind: 'say', text: 'Thinking about the oak table.' })

    // The prose is the newest row, and still not what the rail reads.
    expect(latestNarration(db, [jobId]).get(jobId)).toBe('reading the design')
    const stored = db
      .prepare("SELECT content FROM job_logs WHERE log_type = 'text'")
      .all() as Array<{ content: string }>
    expect(stored.map((row) => row.content)).toEqual(['Thinking about the oak table.'])
  })

  it('writes nothing for a step it has no words for', () => {
    const say = narrator(db, jobId)
    say({ kind: 'tool', name: 'some_new_tool', input: {} })
    say({ kind: 'done', turns: 4 })

    expect(latestNarration(db, [jobId]).get(jobId)).toBeUndefined()
  })

  it('counts the rejections from the job it is narrating, not a shared tally', () => {
    const other = create(db, {
      kind: 'director_turn',
      design_id: null,
      title: 'Director · elsewhere',
      destination: '/designs/2/staging',
    })
    const say = narrator(db, jobId)
    say({ kind: 'tool', name: 'plan_batch', input: {} })
    say({ kind: 'tool', name: 'plan_batch', input: {} })
    narrator(db, other)({ kind: 'tool', name: 'plan_batch', input: {} })

    const lines = latestNarration(db, [jobId, other])
    expect(lines.get(jobId)).toBe('the plan was rejected, writing it again')
    expect(lines.get(other)).toBe('writing the plan')
  })

  it('answers for several jobs in one ask', () => {
    const other = create(db, {
      kind: 'staging_batch',
      design_id: null,
      title: 'Staging · Leaping Gazelle',
      destination: '/designs/1/staging',
    })
    narrator(db, jobId)({ kind: 'tool', name: 'plan_batch', input: {} })
    narrator(db, other)({ kind: 'phase', text: 'generating 4 scenes' })

    const lines = latestNarration(db, [jobId, other])
    expect(lines.get(jobId)).toBe('writing the plan')
    expect(lines.get(other)).toBe('generating 4 scenes')
  })

  it('never lets a logging failure reach the work', () => {
    const broken = { prepare: () => { throw new Error('disk went away') } } as unknown as Db
    expect(() =>
      narrator(broken, jobId)({ kind: 'tool', name: 'view_design', input: {} })
    ).not.toThrow()
  })
})
