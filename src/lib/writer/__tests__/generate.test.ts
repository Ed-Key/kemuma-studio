import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb } from '@/lib/catalog/db'
import { createDesign, addPiece } from '@/lib/catalog/catalog'
import { latestDraftForDesign } from '@/lib/catalog/drafts'
import { generateDraft, type ListingWriter } from '@/lib/writer/generate'
import type { ListingDraft } from '@/lib/writer/schema'

const good: ListingDraft = {
  title: 'Vintage Kenyan Soapstone Coaster Set, Hand Carved in the 1990s',
  description: 'd',
  tags: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12', 't13'],
  price_usd: 49,
  price_justification: 'matches the family price',
  materials: ['soapstone'],
  colorway_notes: 'blue',
}

function setup() {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-gen-')), 'c.sqlite'))
  const designId = createDesign(db, { family: 'coaster set', name: 'Etched Coaster Set' })
  addPiece(db, { design_id: designId, colorway: 'blue', height_in: 3, width_in: 4.5, depth_in: 4.5, weight_lb: 3 })
  return { db, designId }
}

describe('generateDraft', () => {
  it('stores a validated draft', async () => {
    const { db, designId } = setup()
    const writer: ListingWriter = { label: 'fake-model', write: async () => ({ draft: good, input_tokens: 10, output_tokens: 5 }) }
    const draftId = await generateDraft(db, writer, designId)
    const latest = latestDraftForDesign(db, designId)
    expect(latest?.draft_id).toBe(draftId)
    expect(JSON.parse(latest!.generated_json).title).toBe(good.title)
  })

  it('retries once with validation feedback', async () => {
    const { db, designId } = setup()
    const calls: string[] = []
    const writer: ListingWriter = {
      label: 'fake-model',
      write: async (_s, user) => {
        calls.push(user)
        const draft = calls.length === 1 ? { ...good, title: 'ALL CAPS BAD TITLE' } : good
        return { draft, input_tokens: 10, output_tokens: 5 }
      },
    }
    await generateDraft(db, writer, designId)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatch(/caps/i)
  })

  it('throws when the retry also fails', async () => {
    const { db, designId } = setup()
    const writer: ListingWriter = { label: 'fake-model', write: async () => ({ draft: { ...good, title: 'STILL ALL CAPS' }, input_tokens: 10, output_tokens: 5 }) }
    await expect(generateDraft(db, writer, designId)).rejects.toThrow(/validation/i)
  })

  it('stores summed usage across the retry', async () => {
    const { db, designId } = setup()
    let n = 0
    const writer: ListingWriter = {
      label: 'fake-model',
      write: async () => {
        n += 1
        const draft = n === 1 ? { ...good, title: 'ALL CAPS AGAIN HERE' } : good
        return { draft, input_tokens: 100, output_tokens: 50 }
      },
    }
    await generateDraft(db, writer, designId)
    const latest = latestDraftForDesign(db, designId)!
    expect(JSON.parse(latest.usage_json!)).toEqual({ input_tokens: 200, output_tokens: 100 })
    expect(latest.model).toBe('fake-model')
  })
})
