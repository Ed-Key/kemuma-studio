import { describe, it, expect } from 'vitest'
import { pickTaxonomyNode } from '@/lib/etsy/taxonomy'
import type { TaxonomyNode } from '@/lib/etsy/types'

const tree: TaxonomyNode[] = [
  {
    id: 1, name: 'Home & Living',
    children: [
      { id: 2, name: 'Kitchen & Dining', children: [{ id: 3, name: 'Coasters', children: [] }] },
      { id: 4, name: 'Home Decor', children: [{ id: 5, name: 'Decorative Bowls', children: [] }] },
    ],
  },
  {
    id: 6, name: 'Art & Collectibles',
    children: [{ id: 7, name: 'Sculpture', children: [{ id: 8, name: 'Art Objects', children: [] }] }],
  },
  { id: 9, name: 'Jewelry', children: [{ id: 10, name: 'Jewelry Boxes', children: [] }] },
]

describe('pickTaxonomyNode', () => {
  it('maps coaster sets to the Coasters node', () => {
    expect(pickTaxonomyNode(tree, 'coaster set')?.id).toBe(3)
  })
  it('maps figures to Sculpture', () => {
    expect(pickTaxonomyNode(tree, 'figure')?.id).toBe(7)
  })
  it('maps jewelry boxes to Jewelry Boxes', () => {
    expect(pickTaxonomyNode(tree, 'jewelry box')?.id).toBe(10)
  })
  it('maps bowls to Decorative Bowls', () => {
    expect(pickTaxonomyNode(tree, 'bowl')?.id).toBe(5)
  })
  it('returns null for an unknown family', () => {
    expect(pickTaxonomyNode(tree, 'zeppelin')).toBeNull()
  })
})
