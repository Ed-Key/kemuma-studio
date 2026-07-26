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
  subject_and_count: z.string().describe('SUBJECT AND COUNT section body with exact counts using the word "exactly".'),
  composition: z.string().describe('COMPOSITION section body citing real dimensions for scale.'),
  product_lock: z
    .string()
    .describe(
      'PRODUCT LOCK section body. Enumerate only the identity-critical features actually visible in the photo: silhouette, proportions, carving, artwork, banding, veining, colour variation, wear, asymmetries. The opening and closing lock sentences are added for you, so write only the middle.'
    ),
  extra_exclusions: z.array(z.string()).max(4),
  size: z.enum(['1536x1024', '1024x1536']),
  reference_photo_ids: z.array(z.number().int()).max(3),
  n: z.number().int().min(1).max(4).default(4),
})
export type StagingPlan = z.infer<typeof StagingPlanSchema>

// assembleStagingPrompt owns the section order and BASE_EXCLUSIONS; the plan
// supplies a custom pseudo-scene instead of a library template.
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
    subject_and_count: plan.subject_and_count,
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
