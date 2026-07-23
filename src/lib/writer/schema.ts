import { z } from 'zod'

export const ListingDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()).length(13),
  price_usd: z.number(),
  materials: z.array(z.string()).min(1).max(13),
  colorway_notes: z.string(),
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
  draft.tags.forEach((tag, i) => {
    if (tag.length < 1 || tag.length > 20) errors.push(`tag ${i + 1} ("${tag}") must be 1-20 characters`)
    if (tag !== tag.toLowerCase()) errors.push(`tag ${i + 1} ("${tag}") must be lowercase`)
  })
  if (new Set(draft.tags).size !== draft.tags.length) errors.push('tags must be unique')
  if (!(draft.price_usd > 0)) errors.push('price_usd must be positive')
  return errors
}
