import type { TaxonomyNode } from './types'

// Verified against the live Etsy seller taxonomy 2026-07-24. Ed's call: the
// carvings are figurines, not glass art. Ids are stable Etsy identifiers.
export const FAMILY_NODE_IDS: Record<string, number> = {
  'coaster set': 1060, // Coasters
  'trinket dish': 1003, // Decorative Bowls
  'jewelry box': 6102, // Jewelry Boxes
  bowl: 1003,
  'heart dish': 1003,
  figure: 130, // Art & Collectibles > Sculpture > Figurines
  sculpture: 130,
}

// Fallback name search for anything unmapped.
const FAMILY_TERMS: Record<string, string[]> = {
  'coaster set': ['coaster'],
  'trinket dish': ['trinket', 'decorative bowl', 'dish'],
  'jewelry box': ['jewelry box', 'box'],
  bowl: ['decorative bowl', 'bowl'],
  'heart dish': ['trinket', 'decorative bowl', 'dish'],
  figure: ['figurine', 'sculpture'],
  sculpture: ['sculpture', 'figurine'],
}

function findById(nodes: TaxonomyNode[], id: number): TaxonomyNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findById(node.children ?? [], id)
    if (child) return child
  }
  return null
}

function walk(nodes: TaxonomyNode[], visit: (n: TaxonomyNode, depth: number) => void, depth = 0): void {
  for (const node of nodes) {
    visit(node, depth)
    walk(node.children ?? [], visit, depth + 1)
  }
}

function nameSearch(nodes: TaxonomyNode[], family: string): TaxonomyNode | null {
  const normalized = family.toLowerCase()
  const terms = FAMILY_TERMS[normalized] ?? [
    normalized,
    ...normalized.split(/\W+/).filter((term) => term.length > 3),
  ]
  for (const term of terms) {
    let best: { node: TaxonomyNode; depth: number } | null = null
    walk(nodes, (node, depth) => {
      if (node.name.toLowerCase().includes(term)) {
        if (!best || depth > best.depth) best = { node, depth }
      }
    })
    if (best) return (best as { node: TaxonomyNode; depth: number }).node
  }
  return null
}

export function pickTaxonomyNode(nodes: TaxonomyNode[], family: string): TaxonomyNode | null {
  const mappedId = FAMILY_NODE_IDS[family.toLowerCase()]
  if (mappedId != null) {
    const byId = findById(nodes, mappedId)
    if (byId) return byId
  }
  return nameSearch(nodes, family)
}
