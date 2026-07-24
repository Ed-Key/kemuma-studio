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
  ].join('\n')
}

export function buildUserPrompt(input: WriterDesignInput): string {
  const pieces = input.pieces
    .map(
      (p) =>
        `- colorway ${p.colorway}: ${p.height_in}"H x ${p.width_in}"W x ${p.depth_in}"D, ${p.weight_lb} lb, quantity ${p.quantity}`
    )
    .join('\n')
  return [
    `Write the Etsy listing for this design. The attached photos show the actual pieces.`,
    '',
    `Design: ${input.name}`,
    `Family: ${input.family}`,
    input.notes ? `Notes: ${input.notes}` : '',
    'Measured pieces:',
    pieces,
  ]
    .filter(Boolean)
    .join('\n')
}
