import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from '@/lib/writer/prompt'
import { vocabForFamily } from '@/lib/etsy/attribute-vocab'

describe('prompts', () => {
  it('system prompt carries the provenance and voice rules', () => {
    const s = buildSystemPrompt()
    expect(s).toMatch(/Tabaka/)
    expect(s).toMatch(/1990s/)
    expect(s).toMatch(/grandfather and grandmother/)
    expect(s).toMatch(/em dash/i)
  })
  it('user prompt includes measured piece data', () => {
    const u = buildUserPrompt({
      name: 'Etched Coaster Set',
      family: 'coaster set',
      notes: 'holder + 6 coasters',
      pieces: [{ colorway: 'blue', height_in: 3, width_in: 4.5, depth_in: 4.5, weight_lb: 3, quantity: 1 }],
    })
    expect(u).toMatch(/Etched Coaster Set/)
    expect(u).toMatch(/blue/)
    expect(u).toMatch(/4\.5/)
  })
  it('lists allowed colors and art styles when vocab is provided', () => {
    const text = buildUserPrompt(
      { name: 'Lovers Figure', family: 'figure', notes: null, pieces: [] },
      [],
      vocabForFamily('figure')
    )
    expect(text).toMatch(/Folk & outsider/)
    expect(text).toMatch(/primary_color/)
    expect(text).toMatch(/Blue/)
  })
})

describe('catalog price context', () => {
  it('lists approved prices when provided', async () => {
    const { buildUserPrompt } = await import('@/lib/writer/prompt')
    const u = buildUserPrompt(
      {
        name: 'Etched Coaster Set (Tan Gold)',
        family: 'coaster set',
        notes: null,
        pieces: [{ colorway: 'tan gold', height_in: 3, width_in: 4.5, depth_in: 4.5, weight_lb: 7, quantity: 1 }],
      },
      [{ name: 'Etched Coaster Set (Blue)', family: 'coaster set', price_usd: 55, height_in: 3, width_in: 4.5, depth_in: 4.5, weight_lb: 7 }]
    )
    expect(u).toMatch(/pricing comparison/)
    expect(u).toMatch(/Etched Coaster Set \(Blue\) \(coaster set, 3"H x 4.5"W x 4.5"D, 7 lb\): \$55/)
  })
})

describe('price corrections', () => {
  const design = {
    name: 'Sitting Cat Figure',
    family: 'figure',
    notes: null,
    pieces: [{ colorway: 'grey', height_in: 5, width_in: 3, depth_in: 3, weight_lb: 1, quantity: 1 }],
  }

  it('says nothing about corrections before the owner has made any', () => {
    const u = buildUserPrompt(design, [], undefined, [])
    expect(u).not.toMatch(/owner changed/i)
  })

  /* Three of the first four corrections cut the price, one of them from $55 to
     $15, and the owner then called a fourth draft high. The bias is the finding,
     so the prompt states it rather than leaving it to be inferred from a list. */
  it('names the corrections and tells the writer its prices have run high', () => {
    const u = buildUserPrompt(design, [], undefined, [
      { name: 'Elongated Head Bust Figure', proposed: 55, kept: 15 },
      { name: 'Safari Animals Etched Coaster Set', proposed: 68, kept: 55 },
      { name: 'Etched Coaster Set (Blue)', proposed: 58, kept: 55 },
      { name: 'Painted Safari Jewelry Box', proposed: 48, kept: 50 },
    ])
    expect(u).toMatch(/Elongated Head Bust Figure: you proposed \$55, the owner listed it at \$15/)
    expect(u).toMatch(/lowered 3 of those 4/)
    expect(u).toMatch(/run high/)
    expect(u).toMatch(/not a floor/)
  })

  it('drops the warning once the owner stops cutting prices', () => {
    const u = buildUserPrompt(design, [], undefined, [
      { name: 'Painted Safari Jewelry Box', proposed: 48, kept: 50 },
    ])
    expect(u).toMatch(/proposed \$48/)
    expect(u).not.toMatch(/run high/)
  })
})
