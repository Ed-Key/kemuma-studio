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
    expect(system).toMatch(/do not show/)
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

import { VariedArtDirectionSchema, buildVarianceDirectorUserText } from '@/lib/staging/direct'
import { assembleStagingPrompt, validateStagingPrompt, BASE_EXCLUSIONS } from '@/lib/staging/prompt'

describe('variance direction', () => {
  const varied = {
    subject_and_count:
      'Images 1 to 3 are different views of the same two physical sculptures. Show exactly those two figures, each appearing exactly once.',
    product_lock:
      'Use the exact physical product from Image 1. Preserve both silhouettes across all views. Do not restyle, redraw, smooth, or symmetrize.',
    extra_exclusions: [],
    compositions: [
      'As arranged in Image 1, slightly left of center.',
      'Three-quarter turn of the pair, looped figure showing its side profile.',
      'Swapped order, column figure in front, half a step of depth between them.',
      'Closer crop from slightly above, generous negative space to the right.',
    ] as [string, string, string, string],
  }

  it('requires exactly four compositions', () => {
    expect(VariedArtDirectionSchema.parse(varied).compositions).toHaveLength(4)
    expect(() =>
      VariedArtDirectionSchema.parse({ ...varied, compositions: varied.compositions.slice(0, 3) })
    ).toThrow()
  })

  it('each variant assembles into a valid prompt', () => {
    const scene = getScene('bookshelf')
    for (const composition of varied.compositions) {
      const prompt = assembleStagingPrompt(scene, {
        subject_and_count: varied.subject_and_count,
        product_lock: varied.product_lock,
        extra_exclusions: varied.extra_exclusions,
        composition,
      })
      expect(validateStagingPrompt(prompt)).toEqual([])
    }
  })

  it('variance user text explains the reference set and grounding rule', () => {
    const text = buildVarianceDirectorUserText({
      name: 'Lovers Embrace Figure',
      family: 'figure',
      colorway: 'brown tall',
      height_in: 8,
      width_in: 4,
      depth_in: 3,
      quantity: 1,
      scene: getScene('bookshelf'),
      referenceCount: 3,
    })
    expect(text).toContain('Lovers Embrace Figure')
    expect(text).toMatch(/3 photos .*same physical/i)
    expect(text).toMatch(/four different compositions/i)
    expect(text).toMatch(/supported by what the photos show/i)
  })

  it('base exclusions ban readable text everywhere', () => {
    expect(BASE_EXCLUSIONS.join(' ')).toMatch(/No readable text anywhere/)
    expect(BASE_EXCLUSIONS.join(' ')).toMatch(/book spines/)
  })
})
