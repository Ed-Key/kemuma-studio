import { z } from 'zod'
import type { Db } from '@/lib/catalog/db'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { assembleStagingPrompt, validateStagingPrompt } from './prompt'
import type { SceneTemplate, StagingSize } from './scenes'

/* The largest count the words below can name. n is capped to it so the two
   cover the same range: leave n unbounded and {n: 21, what: "twenty-one
   coasters"} sails past the check and assembles as "exactly 21 twenty-one
   coasters". These are handmade sets, so a cap is truthful as well as
   convenient. Raise both together or neither. */
const MAX_COUNT = 20

const NUMBER_WORDS = new Map<string, number>([
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['dozen', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
  ['sixteen', 16],
  ['seventeen', 17],
  ['eighteen', 18],
  ['nineteen', 19],
  ['twenty', 20],
])

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
      z
        .object({
          n: z.number().int().min(1).max(MAX_COUNT),
          /* A bare noun phrase and nothing else. Left open, the model writes the
             whole sentence in here and the assembler doubles it: "Show exactly 1
             exactly one carved cat figure, appearing exactly once". Refusing
             digits and the word itself is what teaches the shape. */
          what: z
            .string()
            .trim()
            .min(1)
            .refine((v) => !/^(?:an?|\d+)\s/i.test(v) && !/\bexactly\b/i.test(v), {
              message:
                'write a bare noun phrase, like "soapstone holder". Do not start with an article or a digit followed by a space, and never use the word "exactly": the count sentence is written for you',
            }),
        })
        .refine(
          ({ n, what }) => NUMBER_WORDS.get(what.split(/\s/, 1)[0].toLowerCase()) !== n,
          {
            path: ['what'],
            message:
              'remove the leading number word from the noun phrase because n already supplies that count',
          }
        )
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
  // "each" turns on the number of objects, not the number of entries. One entry
  // for six coasters still describes six things, and "6 coasters appearing
  // exactly once" reads as the six of them turning up once between them, which
  // is the ambiguity the whole field exists to remove.
  const several = counts.length > 1 || counts.some((c) => c.n > 1)
  const once = several ? 'each appearing exactly once' : 'appearing exactly once'
  return `Image 1 is the only product reference. Show ${list}, ${once}.`
}

/**
 * A stored plan, read back.
 *
 * Plans written before counts replaced the free-text subject line are still
 * sitting in staging_chats, and the card that offers Generate only reads scene
 * and n, so they render as ordinary plans and fail on the click. Their counts
 * cannot be recovered from the prose without guessing at it, and guessing is
 * what this change removed, so a stale plan is retired in words the owner can
 * act on rather than parsed harder.
 */
export type StoredPlan = { ok: true; plan: StagingPlan } | { ok: false; reason: string }

export const STALE_PLAN_REASON =
  'This plan was written before the staging director started counting pieces separately, so it can no longer be generated. Ask the director to plan again.'

/** The chat's copy, still JSON. */
export function parsePendingPlan(json: string): StoredPlan {
  try {
    return parseStoredPlan(JSON.parse(json))
  } catch {
    return { ok: false, reason: STALE_PLAN_REASON }
  }
}

/**
 * A planned_batch job's copy, already parsed.
 *
 * The chat is not the only place a plan lives. A job keeps its own copy so an
 * interrupted batch can be run again, and ten of those in the catalogue hold
 * the old shape. Replaying one has to say the same thing the Generate button
 * says rather than a raw parse error.
 */
export function parseStoredPlan(raw: unknown): StoredPlan {
  const parsed = StagingPlanSchema.safeParse(raw)
  return parsed.success ? { ok: true, plan: parsed.data } : { ok: false, reason: STALE_PLAN_REASON }
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
