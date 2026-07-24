import { describe, it, expect } from 'vitest'
import { ListingDraftSchema, validateEtsyRules, type ListingDraft } from '@/lib/writer/schema'

const valid: ListingDraft = {
  title: 'Vintage Kenyan Soapstone Coaster Set, Hand Carved in the 1990s',
  description: 'A set of six coasters...',
  tags: ['soapstone coasters', 'kenyan soapstone', 'kisii stone', 'vintage coasters', 'african decor', 'stone coaster set', 'bar decor', 'housewarming gift', 'handmade coasters', 'drink coasters', 'tabaka carving', 'blue coasters', 'coaster holder'],
  price_usd: 49,
  price_justification: 'matches the family price',
  materials: ['soapstone'],
  colorway_notes: 'blue',
}

describe('ListingDraftSchema', () => {
  it('accepts a valid draft', () => {
    expect(ListingDraftSchema.parse(valid)).toBeTruthy()
  })
  it('rejects wrong tag count', () => {
    expect(() => ListingDraftSchema.parse({ ...valid, tags: valid.tags.slice(0, 5) })).toThrow()
  })
  it('accepts optional attribute fields and defaults them to null-ish absence', () => {
    const base = {
      title: 'Vintage Soapstone Figurine',
      description: 'd'.repeat(20),
      tags: Array.from({ length: 13 }, (_, i) => `tag${i}`),
      price_usd: 60,
      price_justification: 'x',
      materials: ['soapstone'],
      colorway_notes: 'brown',
    }
    const withAttrs = ListingDraftSchema.parse({ ...base, primary_color: 'Brown', secondary_color: 'Black', art_style: 'Minimalist' })
    expect(withAttrs.primary_color).toBe('Brown')
    // still parses without them
    expect(() => ListingDraftSchema.parse(base)).not.toThrow()
  })
})

describe('validateEtsyRules', () => {
  it('passes a compliant draft', () => {
    expect(validateEtsyRules(valid)).toEqual([])
  })
  it('flags all-caps words in the title', () => {
    const errs = validateEtsyRules({ ...valid, title: 'VINTAGE Kenyan SOAPSTONE Set' })
    expect(errs.join(' ')).toMatch(/caps/i)
  })
  it('flags titles over 140 chars', () => {
    expect(validateEtsyRules({ ...valid, title: 'a'.repeat(141) })).not.toEqual([])
  })
  it('flags long or uppercase tags', () => {
    const tags = [...valid.tags]
    tags[0] = 'this tag is way too long for etsy'
    tags[1] = 'UpperCase'
    const errs = validateEtsyRules({ ...valid, tags })
    expect(errs.length).toBeGreaterThanOrEqual(2)
  })
  it('flags non-positive prices', () => {
    expect(validateEtsyRules({ ...valid, price_usd: 0 })).not.toEqual([])
  })
})
