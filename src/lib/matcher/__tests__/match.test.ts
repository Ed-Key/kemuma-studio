import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto, listEvents } from '@/lib/catalog/catalog'
import { loadCandidates, proposeMatch, buildMatcherUserText, type DesignMatcher } from '@/lib/matcher/match'

async function fixture(dir: string, name: string): Promise<string> {
  const file = path.join(dir, name)
  await mkdir(path.dirname(file), { recursive: true })
  await sharp({ create: { width: 60, height: 60, channels: 3, background: { r: 120, g: 90, b: 60 } } }).jpeg().toFile(file)
  return file
}

async function seed(db: Db, dir: string): Promise<number> {
  const designId = createDesign(db, { family: 'figure', name: 'Lovers Embrace Figure' })
  const pieceId = addPiece(db, { design_id: designId, colorway: 'brown', height_in: 8, width_in: 3, depth_in: 2, weight_lb: 1.5 })
  addPhoto(db, { piece_id: pieceId, file_path: await fixture(dir, 'ex.jpg'), position: 0 })
  return designId
}

describe('loadCandidates / buildMatcherUserText', () => {
  it('lists designs with exemplars and numbers the lineup', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kemuma-match-'))
    const db = openDb(path.join(dir, 'c.sqlite'))
    const designId = await seed(db, dir)
    createDesign(db, { family: 'bowl', name: 'No Photos Design' }) // excluded: no photos
    const candidates = loadCandidates(db)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].design_id).toBe(designId)
    const text = buildMatcherUserText(candidates)
    expect(text).toMatch(/Candidate 1/)
    expect(text).toMatch(/Lovers Embrace Figure/)
  })
})

describe('proposeMatch', () => {
  it('returns new without calling the matcher when the catalog has no candidates', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kemuma-match-'))
    const db = openDb(path.join(dir, 'c.sqlite'))
    let called = false
    const matcher: DesignMatcher = { match: async () => ((called = true), { decision: 'new', design_id: null, confidence: 'high', evidence: '' }) }
    const out = await proposeMatch(db, matcher, [await fixture(dir, 'new.jpg')])
    expect(out.decision).toBe('new')
    expect(called).toBe(false)
  })

  it('applies enforced caution and logs the proposal', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kemuma-match-'))
    const db = openDb(path.join(dir, 'c.sqlite'))
    const designId = await seed(db, dir)
    const matcher: DesignMatcher = {
      match: async () => ({ decision: 'existing', design_id: designId, confidence: 'medium', evidence: 'similar pose' }),
    }
    const out = await proposeMatch(db, matcher, [await fixture(dir, 'new.jpg')])
    expect(out.decision).toBe('abstain')
    expect(listEvents(db).some((e) => e.type === 'match.proposed')).toBe(true)
  })

  it('abstains when the model names a design that is not a candidate', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kemuma-match-'))
    const db = openDb(path.join(dir, 'c.sqlite'))
    await seed(db, dir)
    const matcher: DesignMatcher = {
      match: async () => ({ decision: 'existing', design_id: 9999, confidence: 'high', evidence: 'hallucinated' }),
    }
    const out = await proposeMatch(db, matcher, [await fixture(dir, 'new.jpg')])
    expect(out.decision).toBe('abstain')
  })
})
