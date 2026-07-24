import type { TaxonomyNode } from './types'

// Search terms per design family, most specific first. The picked node is a
// starting point; Ed can still change the category in Etsy's UI pre-publish.
const FAMILY_TERMS: Record<string, string[]> = {
  'coaster set': ['coaster'],
  'trinket dish': ['trinket', 'decorative bowl', 'dish'],
  'jewelry box': ['jewelry box', 'box'],
  bowl: ['decorative bowl', 'bowl'],
  'heart dish': ['trinket', 'decorative bowl', 'dish'],
  figure: ['sculpture', 'figurine'],
  sculpture: ['sculpture', 'art object'],
}

function walk(nodes: TaxonomyNode[], visit: (n: TaxonomyNode, depth: number) => void, depth = 0): void {
  for (const node of nodes) {
    visit(node, depth)
    walk(node.children ?? [], visit, depth + 1)
  }
}

export function pickTaxonomyNode(nodes: TaxonomyNode[], family: string): TaxonomyNode | null {
  const terms = FAMILY_TERMS[family.toLowerCase()] ?? [family.toLowerCase()]
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
