import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb } from '@/lib/catalog/db'
import { createDesign, addPiece, listEvents } from '@/lib/catalog/catalog'
import { listLatestDraftPerModel } from '@/lib/catalog/drafts'
import { runBakeoff } from '@/lib/writer/bakeoff'
import type { ListingWriter } from '@/lib/writer/generate'
import type { ListingDraft } from '@/lib/writer/schema'

const good: ListingDraft = {
  title: 'Vintage Kenyan Soapstone Coaster Set',
  description: 'd',
  tags: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12', 't13'],
  price_usd: 49,
  materials: ['soapstone'],
  colorway_notes: 'blue',
}

describe('runBakeoff', () => {
  it('generates one draft per spec and captures per-spec failures', async () => {
    const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-bake-')), 'c.sqlite'))
    const designId = createDesign(db, { family: 'coaster set', name: 'Set' })
    addPiece(db, { design_id: designId, colorway: 'blue', height_in: 3, width_in: 4, depth_in: 4, weight_lb: 3 })

    const makeWriter = (spec: string): ListingWriter => ({
      label: spec,
      write: async () => {
        if (spec.startsWith('xai:')) throw new Error('no credits')
        return { draft: good, input_tokens: 10, output_tokens: 5 }
      },
    })

    const results = await runBakeoff(db, designId, ['anthropic:claude-opus-4-8', 'gemini:gemini-2.5-flash', 'xai:grok-4'], makeWriter)
    expect(results.filter((r) => r.draft_id)).toHaveLength(2)
    expect(results.find((r) => r.spec === 'xai:grok-4')?.error).toMatch(/no credits/)
    expect(listLatestDraftPerModel(db, designId).map((d) => d.model)).toEqual([
      'anthropic:claude-opus-4-8',
      'gemini:gemini-2.5-flash',
    ])
    expect(listEvents(db).some((e) => e.type === 'bakeoff.ran')).toBe(true)
  })
})
