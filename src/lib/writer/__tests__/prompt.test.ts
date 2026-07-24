import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from '@/lib/writer/prompt'

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
