import { describe, expect, it } from 'vitest'
import {
  catalogDisplayName,
  describeDesign,
  compareCardPriority,
  hrefFor,
  nextAction,
  parsePushWarnings,
  statusFor,
  verbFor,
} from '@/lib/catalog/card-state'

const COMPLETE = {
  pieceCount: 1,
  draftStatus: 'approved' as const,
  onEtsy: true,
  published: true,
  toReview: 0,
  pushWarnings: [] as string[],
}

describe('catalog card state', () => {
  it('sorts a warned push ahead of every ordinary stage', () => {
    const publish = nextAction({ ...COMPLETE, published: false })
    const warned = nextAction({
      ...COMPLETE,
      pushWarnings: ['variations failed (etsy said: invalid inventory)'],
    })
    const cards = [
      { name: 'Ready to publish', stage: publish.stage },
      { name: 'Broken live listing', stage: warned.stage },
    ]

    cards.sort(compareCardPriority)

    expect(cards.map((card) => card.name)).toEqual(['Broken live listing', 'Ready to publish'])
  })

  it('derives image retry copy from the number of failed uploads', () => {
    expect(
      verbFor({
        stage: 7,
        toReview: 0,
        published: false,
        pushWarnings: [
          'image 14 failed to upload: timeout',
          'image 18 failed to upload: invalid file',
        ],
        price: 58,
        totalQuantity: 4,
      })
    ).toBe('Re-upload 2 images')
  })

  it('directs a failed variation push back to Etsy', () => {
    expect(
      verbFor({
        stage: 7,
        toReview: 0,
        published: true,
        pushWarnings: ['variations failed (etsy said: quantity must be consistent across all products)'],
        price: 58,
        totalQuantity: 4,
      })
    ).toBe('Re-push to Etsy')
    expect(hrefFor(12, 7, true)).toBe('/designs/12/draft')
  })

  it('names rejected Etsy attributes instead of using the fallback', () => {
    expect(
      verbFor({
        stage: 7,
        toReview: 0,
        published: false,
        pushWarnings: ['Primary color value "Olive" not available in this category; skipped'],
        price: 58,
        totalQuantity: 4,
      })
    ).toBe('Retry Etsy attributes')
  })

  it('uses each draft price instead of repeating a stage-only footer', () => {
    const first = verbFor({
      stage: 2,
      toReview: 0,
      published: false,
      pushWarnings: [],
      price: 58,
      totalQuantity: 4,
    })
    const second = verbFor({
      stage: 2,
      toReview: 0,
      published: false,
      pushWarnings: [],
      price: 72,
      totalQuantity: 4,
    })

    expect(first).toBe('Review the $58 draft')
    expect(second).toBe('Review the $72 draft')
  })

  it('keeps published status quiet and cleans only the catalog display name', () => {
    expect(statusFor(['listed'], true, true).cls).toBe('pill pill--ok')
    expect(catalogDisplayName('Etched Coaster Set (Olive Green)')).toBe('Etched Coaster Set')
    expect(catalogDisplayName('Parenthetical (Detail) in Name')).toBe('Parenthetical (Detail) in Name')
  })

  it('parses stored warnings without letting malformed history break the catalog', () => {
    expect(parsePushWarnings('["one","two"]')).toEqual(['one', 'two'])
    expect(parsePushWarnings('{"warning":"wrong shape"}')).toEqual([])
    expect(parsePushWarnings('not json')).toEqual([])
    expect(parsePushWarnings(null)).toEqual([])
  })
})

describe('describeDesign', () => {
  it('keeps the description and drops the measurement bookkeeping', () => {
    expect(
      describeDesign('holder + 6 round coasters, etched geometric patterns; dims VERIFIED by Ed 2026-07-24; weight VERIFIED by Ed')
    ).toBe('holder + 6 round coasters, etched geometric patterns')
  })

  it('drops an estimated warning that is already shown against the measurements', () => {
    expect(describeDesign('leaf/canoe shape with handle; dims/weight ESTIMATED from photos; verify before listing'))
      .toBe('leaf/canoe shape with handle')
  })

  it('returns nothing when the notes are only bookkeeping', () => {
    expect(describeDesign('dims/weight ESTIMATED from photos; verify before listing')).toBe('')
  })

  it('handles absent notes', () => {
    expect(describeDesign(null)).toBe('')
    expect(describeDesign(undefined)).toBe('')
  })
})
