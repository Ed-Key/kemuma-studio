import { describe, it, expect } from 'vitest'
import { getScene } from '@/lib/staging/scenes'
import { ArtDirectionSchema, buildDirectorSystemPrompt, buildDirectorUserText } from '@/lib/staging/direct'

describe('ArtDirectionSchema', () => {
  it('accepts a complete direction', () => {
    const parsed = ArtDirectionSchema.parse({
      subject_and_count: 'Image 1 is the only product reference. Exactly one set of exactly four coasters.',
      composition: 'Loose fan slightly left of center at 3.8-inch scale.',
      product_lock: 'Use the exact physical product from Image 1. Do not restyle, redraw, smooth, or symmetrize.',
      extra_exclusions: [],
    })
    expect(parsed.extra_exclusions).toEqual([])
  })

  it('caps extra exclusions at four', () => {
    expect(() =>
      ArtDirectionSchema.parse({
        subject_and_count: 'x', composition: 'x', product_lock: 'x',
        extra_exclusions: ['a', 'b', 'c', 'd', 'e'],
      })
    ).toThrow()
  })
})

describe('director prompts', () => {
  it('system prompt demands the mandatory sentences and photo-first rules', () => {
    const system = buildDirectorSystemPrompt()
    expect(system).toContain('Use the exact physical product from Image 1.')
    expect(system).toContain('Do not restyle, redraw, smooth, or symmetrize.')
    expect(system).toMatch(/exactly/)
    expect(system).toMatch(/photo wins/)
    expect(system).toMatch(/does not show/)
  })

  it('user text carries the record and the scene', () => {
    const text = buildDirectorUserText({
      name: 'Safari Sunset Coasters',
      family: 'coaster set',
      colorway: 'sunset',
      height_in: 0.3,
      width_in: 3.8,
      depth_in: 3.8,
      quantity: 1,
      scene: getScene('coffee-table'),
    })
    expect(text).toContain('Safari Sunset Coasters')
    expect(text).toContain('3.8')
    expect(text).toContain('sunset colorway')
    expect(text).toContain('light-oak coffee table')
    expect(text).toMatch(/count the pieces visible/i)
  })
})
