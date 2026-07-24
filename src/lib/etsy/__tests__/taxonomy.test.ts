import { describe, it, expect } from 'vitest'
import { pickTaxonomyNode, FAMILY_NODE_IDS } from '@/lib/etsy/taxonomy'
import type { TaxonomyNode } from '@/lib/etsy/types'

const tree: TaxonomyNode[] = [
  {
    id: 1, name: 'Home & Living',
    children: [
      { id: 2, name: 'Kitchen & Dining', children: [{ id: 1060, name: 'Coasters', children: [] }] },
      { id: 4, name: 'Home Decor', children: [{ id: 1003, name: 'Decorative Bowls', children: [] }] },
    ],
  },
  {
    id: 6, name: 'Art & Collectibles',
    children: [
      { id: 128, name: 'Sculpture', children: [{ id: 130, name: 'Figurines', children: [] }] },
      { id: 2889, name: 'Glass Sculptures & Figurines', children: [] },
    ],
  },
  { id: 9, name: 'Jewelry', children: [{ id: 6102, name: 'Jewelry Boxes', children: [] }] },
]

describe('pickTaxonomyNode', () => {
  it('maps coaster sets to the Coasters node', () => {
    expect(pickTaxonomyNode(tree, 'coaster set')?.id).toBe(1060)
  })
  it('maps figures to Figurines', () => {
    expect(pickTaxonomyNode(tree, 'figure')?.id).toBe(130)
  })
  it('maps jewelry boxes to Jewelry Boxes', () => {
    expect(pickTaxonomyNode(tree, 'jewelry box')?.id).toBe(6102)
  })
  it('maps bowls to Decorative Bowls', () => {
    expect(pickTaxonomyNode(tree, 'bowl')?.id).toBe(1003)
  })
  it('returns null for an unknown family', () => {
    expect(pickTaxonomyNode(tree, 'zeppelin')).toBeNull()
  })
})

describe('pickTaxonomyNode id preference', () => {
  it('maps figures to Figurines (130), not the glass node', () => {
    expect(FAMILY_NODE_IDS['figure']).toBe(130)
    expect(pickTaxonomyNode(tree, 'figure')?.id).toBe(130)
    expect(pickTaxonomyNode(tree, 'sculpture')?.id).toBe(130)
  })

  it('maps dish and bowl families to Decorative Bowls (1003)', () => {
    expect(pickTaxonomyNode(tree, 'heart dish')?.id).toBe(1003)
    expect(pickTaxonomyNode(tree, 'bowl')?.id).toBe(1003)
  })

  it('falls back to name search for unmapped families', () => {
    expect(pickTaxonomyNode(tree, 'sculpture and figurines')?.name).toMatch(/Sculpture|Figurines/)
  })
})
