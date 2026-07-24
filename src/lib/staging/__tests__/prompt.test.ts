import { describe, it, expect } from 'vitest'
import { getScene } from '@/lib/staging/scenes'
import { assembleStagingPrompt, validateStagingPrompt, type ArtDirection } from '@/lib/staging/prompt'

const direction: ArtDirection = {
  subject_and_count:
    'Image 1 is the only product reference. Show exactly one coaster set consisting of exactly four coasters. The set appears exactly once.',
  composition:
    'The four coasters sit in a loose overlapping fan slightly left of center at realistic 3.8-inch scale, three-quarter tabletop view, generous negative space.',
  product_lock:
    'Use the exact physical product from Image 1. Preserve its silhouette, uneven hand-cut edges, painted safari sunset artwork, banding, and asymmetries. Do not restyle, redraw, smooth, or symmetrize.',
  extra_exclusions: ['No extra coasters beyond the four shown.'],
}

describe('assembleStagingPrompt', () => {
  it('joins the six labeled sections in order', () => {
    const prompt = assembleStagingPrompt(getScene('coffee-table'), direction)
    const order = [
      'SCENE - ', 'SUBJECT AND COUNT - ', 'COMPOSITION - ',
      'LIGHTING AND INTEGRATION - ', 'PRODUCT LOCK - ', 'EXCLUSIONS - ',
    ].map((label) => prompt.indexOf(label))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(prompt).toContain('No extra coasters beyond the four shown.')
    expect(prompt).toContain('No duplicate product')
  })

  it('assembled prompts pass validation', () => {
    expect(validateStagingPrompt(assembleStagingPrompt(getScene('bookshelf'), direction))).toEqual([])
  })
})

describe('validateStagingPrompt', () => {
  const valid = assembleStagingPrompt(getScene('coffee-table'), direction)

  it.each([
    ['exactly', /exact piece counts/],
    ['never composited', /never composited/],
    ['Relight', /relight/i],
    ['Use the exact physical product from Image 1.', /PRODUCT LOCK must open/],
    ['Do not restyle, redraw, smooth, or symmetrize.', /lock sentence/],
    ['No duplicate product', /duplicate-product/],
  ])('flags a prompt missing "%s"', (needle, message) => {
    const broken = valid.replaceAll(needle, '')
    expect(validateStagingPrompt(broken).join('; ')).toMatch(message)
  })
})
