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

  it('names the plan section being written', () => {
    expect(describeStep({ kind: 'writing', section: 'product_lock' })).toBe(
      'writing the product lock'
    )
    expect(describeStep({ kind: 'writing', section: 'subject_and_count' })).toBe(
      'writing what is in frame'
    )
  })

  it('stays quiet about the sections that are not thinking', () => {
    // n and the photo ids are settled long before they are typed, so
    // announcing them would narrate typing speed.
    expect(describeStep({ kind: 'writing', section: 'n' })).toBeNull()
    expect(describeStep({ kind: 'writing', section: 'reference_photo_ids' })).toBeNull()
  })

  it('passes a phase through as written', () => {
    expect(describeStep({ kind: 'phase', text: 'generating 4 scenes' })).toBe('generating 4 scenes')
    expect(describeStep({ kind: 'phase', text: '   ' })).toBeNull()
  })

  /* The rail used to say only that the plan was rejected again, because the
     narrator sees tool calls and never their results. Eight runs looped in
     production and not one recorded which rule fired. */
  it('says which rule rejected the plan, not just that one did', () => {
    expect(
      describeStep({
        kind: 'rejected',
        reason: 'SUBJECT AND COUNT must state exact piece counts using the word "exactly"',
      })
    ).toBe('the plan was rejected: SUBJECT AND COUNT must state exact piece counts using the word "exactly"')
  })

  it('reports when the director has given up rather than looping on silently', () => {
    expect(describeStep({ kind: 'rejected', reason: 'x', gaveUp: true })).toMatch(/gave up|could not/i)
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

  /* The production catalogue has 590 tool_use rows and 13 text rows across the
     eight runs that looped, and zero tool_result rows. The reason was produced
     and thrown away every single time. This is the row that was missing. */
  it('writes the rejection reason to the job log where it can be read later', () => {
    const designId = createDesign(db, { family: 'trinket dish', name: 'Canoe Trinket Dish' })
    const jobId = create(db, {
      kind: 'director_turn',
      design_id: designId,
      title: 'Director · Canoe Trinket Dish',
      destination: `/designs/${designId}/staging`,
    })
    const say = narrator(db, jobId)

    say({ kind: 'tool', name: 'plan_batch', input: {} })
    say({
      kind: 'rejected',
      reason: 'SUBJECT AND COUNT must state exact piece counts using the word "exactly"',
    })

    const rows = db
      .prepare('SELECT log_type, content FROM job_logs WHERE job_id = ? ORDER BY rowid')
      .all(jobId) as Array<{ log_type: string; content: string }>
    const rejection = rows.find((r) => r.log_type === 'tool_result')

    expect(rejection).toBeDefined()
    expect(rejection!.content).toMatch(/exactly/)
    expect(latestNarration(db, [jobId]).get(jobId)).toMatch(/the plan was rejected: /)
  })

})
