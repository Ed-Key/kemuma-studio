// Static, verified against the live Etsy taxonomy 2026-07-24. Drives the
// writer prompt and review UI with no gateway coupling; the push resolves
// these names to value_ids live and warns on any miss.
export interface FamilyVocab {
  materialProperty: string
  materialValue: string
  colors: string[]
  artStyleProperty?: string
  artStyles?: string[]
  mountProperty?: string
  mountValue?: string
  hasDimensions: boolean
}

// Etsy's standard color palette (push matches by name, so extras are harmless).
const COLORS = [
  'Beige', 'Black', 'Blue', 'Bronze', 'Brown', 'Clear', 'Copper', 'Gold', 'Gray',
  'Green', 'Orange', 'Pink', 'Purple', 'Red', 'Rose gold', 'Silver', 'White', 'Yellow',
]

const FIGURE_VOCAB: FamilyVocab = {
  materialProperty: 'Art medium',
  materialValue: 'Stone', // Art medium has no Soapstone value; Stone is the closest real option
  colors: COLORS,
  artStyleProperty: 'Art style',
  artStyles: ['Folk & outsider', 'Minimalist'],
  mountProperty: 'Art mount type',
  mountValue: 'Tabletop',
  hasDimensions: true,
}

const BOWL_VOCAB: FamilyVocab = {
  materialProperty: 'Material multi',
  materialValue: 'Soapstone',
  colors: COLORS,
  hasDimensions: true,
}

const COASTER_VOCAB: FamilyVocab = {
  materialProperty: 'Material multi',
  materialValue: 'Soapstone',
  colors: COLORS,
  hasDimensions: false,
}

const JEWELRY_BOX_VOCAB: FamilyVocab = {
  materialProperty: 'Material multi',
  materialValue: 'Soapstone',
  colors: COLORS,
  hasDimensions: false, // dimensions exist but under 'Box bag *'; out of scope for now
}

const BY_FAMILY: Record<string, FamilyVocab> = {
  figure: FIGURE_VOCAB,
  sculpture: FIGURE_VOCAB,
  'trinket dish': BOWL_VOCAB,
  bowl: BOWL_VOCAB,
  'heart dish': BOWL_VOCAB,
  'coaster set': COASTER_VOCAB,
  'jewelry box': JEWELRY_BOX_VOCAB,
}

export function vocabForFamily(family: string): FamilyVocab {
  return BY_FAMILY[family.toLowerCase()] ?? BOWL_VOCAB
}
