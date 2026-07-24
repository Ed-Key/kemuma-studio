export interface WriterDesignInput {
  name: string
  family: string
  notes: string | null
  pieces: Array<{
    colorway: string
    height_in: number
    width_in: number
    depth_in: number
    weight_lb: number
    quantity: number
  }>
}

export function buildSystemPrompt(): string {
  return [
    'You write Etsy listings for Kemuma Carvings, a shop selling a finite family collection of vintage soapstone pieces.',
    '',
    'Provenance facts, true for every piece and required in every description:',
    '- Hand carved by my grandfather and grandmother in Tabaka, Kisii County, Kenya, in the mid-1990s.',
    '- Write in first person: the seller is their grandson, so say "my grandfather and grandmother",',
    '  never "the seller\'s". (Ed\'s edit on the first reviewed draft, 2026-07-24.)',
    '- Genuine vintage (about 30 years old). When a piece sells out, no more exist.',
    '- Natural soapstone varies in color banding and surface pattern; each piece is subtly unique.',
    '',
    'Voice rules, strict:',
    '- Plain, warm prose. No emojis. Do not use em dashes; use periods, commas, or parentheses.',
    '- No hype cliches ("stunning", "must-have"), no "not X, but Y" constructions.',
    '',
    'Format rules, machine-enforced by Etsy:',
    '- Title: 140 characters max, no all-caps words, starts with a letter or number, under 15 words,',
    '  leading with material, design, and size. Include "vintage" and "1990s" naturally.',
    '- Exactly 13 tags, each 1-20 characters, lowercase, unique, multi-word phrases buyers would search.',
    '- Description structure: two opening sentences naming the piece, material, origin, and story; then',
    '  short scannable sections covering what the buyer receives, maker and origin, dimensions and weight,',
    '  color and natural variation, use and care, packaging, and the vintage nature of the collection.',
    '- price_usd: a realistic US price for handmade/vintage stone decor of this size and category,',
    '  keeping in mind $35+ qualifies for free-shipping treatment on Etsy.',
    '- When a design exists in multiple colorways, the listing has a colorway picker: write the title',
    '  and description to cover the full range (name the available colorways in the description),',
    '  never copy specific to a single colorway. Single-colorway designs may name their color.',
  ].join('\n')
}

export interface CatalogPriceRef {
  name: string
  family: string
  price_usd: number
  height_in: number | null
  width_in: number | null
  depth_in: number | null
  weight_lb: number | null
}

export function buildUserPrompt(
  input: WriterDesignInput,
  catalogPrices: CatalogPriceRef[] = [],
  vocab?: import('@/lib/etsy/attribute-vocab').FamilyVocab
): string {
  const pieces = input.pieces
    .map(
      (p) =>
        `- colorway ${p.colorway}: ${p.height_in}"H x ${p.width_in}"W x ${p.depth_in}"D, ${p.weight_lb} lb, quantity ${p.quantity}`
    )
    .join('\n')
  const priceContext =
    catalogPrices.length > 0
      ? [
          '',
          'Approved catalog listings, with their attributes, for pricing comparison:',
          ...catalogPrices.map((p) => {
            const dims =
              p.height_in != null ? `, ${p.height_in}"H x ${p.width_in}"W x ${p.depth_in}"D, ${p.weight_lb} lb` : ''
            return `- ${p.name} (${p.family}${dims}): $${p.price_usd}`
          }),
          'Pricing rules: find the most similar items above (same family, similar size and weight,',
          'similar workmanship) and price consistently with them. If a view_comparable tool is',
          'available, call it on the closest comparables to see their photos before deciding.',
          'In price_justification, name the comparable(s) you matched; if your price differs from',
          'theirs, state exactly why this piece earns more or less. Never leave a price unexplained.',
        ].join('\n')
      : ''
  const attrSection = vocab
    ? [
        '',
        'STRUCTURED ATTRIBUTES (for Etsy search facets; choose from these exact values or omit if unsure):',
        `- primary_color and secondary_color: one each from [${vocab.colors.join(', ')}]. Judge from the photos.`,
        ...(vocab.artStyles ? [`- art_style: one of [${vocab.artStyles.join(', ')}].`] : []),
      ].join('\n')
    : ''
  return [
    `Write the Etsy listing for this design. The attached photos show the actual pieces.`,
    '',
    `Design: ${input.name}`,
    `Family: ${input.family}`,
    input.notes ? `Notes: ${input.notes}` : '',
    'Measured pieces:',
    pieces,
    priceContext,
    attrSection,
  ]
    .filter(Boolean)
    .join('\n')
}
