import { z } from 'zod'
import type { Db } from '@/lib/catalog/db'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { assembleStagingPrompt, validateStagingPrompt } from './prompt'
import type { SceneTemplate, StagingSize } from './scenes'

export const StagingPlanSchema = z.object({
  scene: z.string().describe('SCENE section body: environment, mood, and any owner-requested props described concretely.'),
  lighting: z
    .string()
    .describe(
      'LIGHTING AND INTEGRATION section body. Describe only this scene\'s own light: direction, quality, colour temperature, and the contact shadows that ground the piece. The mandatory "never composited, relight to the scene" sentence is added for you, so do not write it.'
    ),
  /* Counts are data, not prose. Asking a writer to remember the literal word
     "exactly" is the thing language models are worst at, and the catalogue has
     eight runs that failed that check between four and thirteen times each.
     The model supplies the fact; assemblePlanPrompt supplies the sentence, so
     the word cannot go missing. Compound sets need the array: a coaster set is
     one holder and six coasters, not one thing. */
  counts: z
    .array(
      z.object({
        n: z.number().int().min(1),
        /* A bare noun phrase and nothing else. Left open, the model writes the
           whole sentence in here and the assembler doubles it: "Show exactly 1
           exactly one carved cat figure, appearing exactly once". Refusing
           digits and the word itself is what teaches the shape. */
        what: z
          .string()
          .min(1)
          /* Only a leading count is banned, and a count is a number followed by
             a space. "6-inch base" and "2-piece set" are ordinary noun phrases
             and must pass; a false rejection here starts exactly the loop this
             field replaced. */
          .refine((v) => !/^\s*(\d+\s|an?\s|one\s|two\s|three\s|four\s|five\s|six\s)/i.test(v) && !/\bexactly\b/i.test(v), {
            message:
              'write a bare noun phrase, like "soapstone holder". Do not start with a number or an article, and never use the word "exactly": the count sentence is written for you',
          }),
      })
    )
    .min(1)
    .max(4)
    .describe(
      'The PRODUCT only, broken into its distinct parts, and how many of each. A coaster set is [{"n":1,"what":"soapstone holder"},{"n":6,"what":"coasters"}]. Props and scenery are NOT counted here; they belong in scene. At most 4 entries.'
    ),
  arrangement: z
    .string()
    .describe('How the product sits: what faces the camera, what is stacked or fanned, and where any props sit relative to it.'),
  composition: z.string().describe('COMPOSITION section body citing real dimensions for scale.'),
  product_lock: z
    .string()
    .describe(
      'PRODUCT LOCK section body. Enumerate only the identity-critical features actually visible in the photo: silhouette, proportions, carving, artwork, banding, veining, colour variation, wear, asymmetries. The opening and closing lock sentences are added for you, so write only the middle.'
    ),
  extra_exclusions: z.array(z.string()).max(4).describe('At most 4 extra things to ban, beyond the standard exclusions already added for you.'),
  size: z.enum(['1536x1024', '1024x1536']),
  reference_photo_ids: z.array(z.number().int()).min(1).max(3).describe('At most 3 photo ids of THIS design, best view first.'),
  n: z.number().int().min(1).max(4).default(4),
})
export type StagingPlan = z.infer<typeof StagingPlanSchema>

// assembleStagingPrompt owns the section order and BASE_EXCLUSIONS; the plan
// supplies a custom pseudo-scene instead of a library template.
/** "exactly 1 soapstone holder and exactly 6 coasters" */
export function countSentence(counts: StagingPlan['counts']): string {
  const parts = counts.map((c) => `exactly ${c.n} ${c.what}`)
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  const once = counts.length === 1 ? 'appearing exactly once' : 'each appearing exactly once'
  return `Image 1 is the only product reference. Show ${list}, ${once}.`
}

export function assemblePlanPrompt(plan: StagingPlan): string {
  const pseudoScene: SceneTemplate = {
    key: 'chat',
    label: 'Custom scene',
    families: [],
    size: plan.size as StagingSize,
    scene: plan.scene,
    lighting: plan.lighting,
  }
  return assembleStagingPrompt(pseudoScene, {
    subject_and_count: `${countSentence(plan.counts)} ${plan.arrangement}`.trim(),
    composition: plan.composition,
    product_lock: plan.product_lock,
    extra_exclusions: plan.extra_exclusions,
  })
}

export function validatePlan(db: Db, designId: number, plan: StagingPlan): string[] {
  const errors = validateStagingPrompt(assemblePlanPrompt(plan))
  if (plan.reference_photo_ids.length === 0) {
    errors.push('pick at least one reference photo of this design')
  } else {
    const detail = getDesignDetail(db, designId)
    const owned = new Set(detail?.pieces.flatMap((p) => p.photos.map((ph) => ph.photo_id)) ?? [])
    const strangers = plan.reference_photo_ids.filter((id) => !owned.has(id))
    if (strangers.length > 0) errors.push(`photos ${strangers.join(', ')} are not photos of this design`)
  }
  return errors
}
