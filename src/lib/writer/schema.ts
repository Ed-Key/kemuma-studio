import { z } from 'zod'

export const ListingDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()).length(13),
  price_usd: z.number(),
  price_justification: z.string(),
  materials: z.array(z.string()).min(1).max(13),
  colorway_notes: z.string(),
  primary_color: z.string().nullish().describe('Etsy primary color, chosen from the allowed list in the prompt, or omitted if unsure.'),
  secondary_color: z.string().nullish().describe('Etsy secondary color from the allowed list, or omitted.'),
  art_style: z.string().nullish().describe('Etsy art style from the allowed list (figurines only), or omitted.'),
})

export type ListingDraft = z.infer<typeof ListingDraftSchema>

// Etsy's API machine-enforces title style (learned live in step 1). We are
// stricter than the API on caps (zero all-caps words vs its limit of 3) so
// drafts never bounce.
export function validateEtsyRules(draft: ListingDraft): string[] {
  const errors: string[] = []
  if (draft.title.length > 140) errors.push('title must be 140 characters or fewer')
  if (!/^[a-zA-Z0-9]/.test(draft.title)) errors.push('title must start with a letter or number')
  const capsWords = draft.title.split(/\s+/).filter((w) => /^[A-Z]{2,}/.test(w))
  if (capsWords.length > 0) {
    errors.push(`title must not contain all-caps words (found: ${capsWords.join(', ')})`)
  }
  // Etsy's own limit is still 140 characters, but its April 2026 guidance asks
  // for under 15 words and says keyword-stuffed titles are no longer rewarded.
  // Checked here so a title in the old style cannot be approved by habit.
  const words = draft.title.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 15) {
    errors.push(`title should be under 15 words (found ${words.length}); lead with what the item is`)
  }
  const banned = ['handmade', 'perfect', 'beautiful', 'stunning', 'free shipping', 'gift for']
  const lowered = draft.title.toLowerCase()
  const found = banned.filter((word) => lowered.includes(word))
  if (found.length > 0) {
    errors.push(`title should not contain ${found.join(', ')}; that belongs in the description`)
  }
  draft.tags.forEach((tag, i) => {
    if (tag.length < 1 || tag.length > 20) errors.push(`tag ${i + 1} ("${tag}") must be 1-20 characters`)
    if (tag !== tag.toLowerCase()) errors.push(`tag ${i + 1} ("${tag}") must be lowercase`)
  })
  if (new Set(draft.tags).size !== draft.tags.length) errors.push('tags must be unique')
  if (!(draft.price_usd > 0)) errors.push('price_usd must be positive')
  return errors
}
