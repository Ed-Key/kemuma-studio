import { describe, it, expect } from 'vitest'
import { vocabForFamily } from '@/lib/etsy/attribute-vocab'

describe('attribute vocabulary', () => {
  it('figures use Art medium Stone, art style, tabletop mount, and dimensions', () => {
    const v = vocabForFamily('figure')
    expect(v.materialProperty).toBe('Art medium')
    expect(v.materialValue).toBe('Stone')
    expect(v.artStyleProperty).toBe('Art style')
    expect(v.artStyles).toEqual(expect.arrayContaining(['Folk & outsider', 'Minimalist']))
    expect(v.mountValue).toBe('Tabletop')
    expect(v.hasDimensions).toBe(true)
  })

  it('bowls and dishes use Material multi Soapstone with dimensions, no art style', () => {
    const v = vocabForFamily('heart dish')
    expect(v.materialProperty).toBe('Material multi')
    expect(v.materialValue).toBe('Soapstone')
    expect(v.artStyleProperty).toBeUndefined()
    expect(v.hasDimensions).toBe(true)
  })

  it('coasters use Material multi Soapstone but have no dimension attributes', () => {
    const v = vocabForFamily('coaster set')
    expect(v.materialProperty).toBe('Material multi')
    expect(v.materialValue).toBe('Soapstone')
    expect(v.hasDimensions).toBe(false)
  })

  it('exposes the standard color palette', () => {
    expect(vocabForFamily('figure').colors).toEqual(expect.arrayContaining(['Black', 'Blue', 'Brown', 'Gray', 'Green']))
  })
})
