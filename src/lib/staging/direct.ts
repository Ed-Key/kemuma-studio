import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { ApiImageBlock } from '@/lib/writer/generate'
import type { SceneTemplate } from './scenes'
import type { ArtDirection } from './prompt'

export const ArtDirectionSchema = z.object({
  subject_and_count: z
    .string()
    .describe(
      'SUBJECT AND COUNT section body. Identify Image 1 as the only product reference. State the exact number of sets and constituent pieces visible in the photo using the word "exactly", and state that the product appears exactly once.'
    ),
  composition: z
    .string()
    .describe(
      'COMPOSITION section body. Placement on the scene surface, realistic scale citing the given dimensions in inches, framing and viewpoint matching the reference photo angle, generous negative space. Never request a viewpoint the reference photo does not show.'
    ),
  product_lock: z
    .string()
    .describe(
      'PRODUCT LOCK section body. Open with the exact sentence "Use the exact physical product from Image 1." Enumerate only identity-critical features actually visible in the photo (silhouette, proportions, carving, artwork, banding, veining, color variation, wear, asymmetries). End with the exact sentence "Do not restyle, redraw, smooth, or symmetrize."'
    ),
  extra_exclusions: z
    .array(z.string())
    .max(4)
    .describe(
      'Product-specific exclusions beyond the standard list, e.g. "No extra coasters beyond the four shown." Empty array when none are needed.'
    ),
})

// Variance mode (Ed's request, 2026-07-24): several reference views let the
// model understand the carving's real geometry, so each candidate can take a
// different arrangement without inventing unseen surfaces. Empirically
// validated on the Lovers Embrace pair before building.
export const VariedArtDirectionSchema = z.object({
  subject_and_count: z
    .string()
    .describe(
      'SUBJECT AND COUNT section body. State that the numbered images are different views of the SAME physical product, not additional products. State the exact number of constituent pieces visible using the word "exactly", each appearing exactly once.'
    ),
  product_lock: ArtDirectionSchema.shape.product_lock,
  extra_exclusions: ArtDirectionSchema.shape.extra_exclusions,
  compositions: z
    .tuple([z.string(), z.string(), z.string(), z.string()])
    .describe(
      'Four DIFFERENT COMPOSITION section bodies, one per candidate. Vary arrangement, viewing angle, ordering, spacing, and crop. Variant 1 stays close to the primary reference arrangement; variants 2 to 4 may rotate the group or reorder pieces, but only to angles whose surfaces are supported by the reference views. Each variant cites the given dimensions for scale.'
    ),
})
export type VariedArtDirection = z.infer<typeof VariedArtDirectionSchema>

export function artDirectorModel(): string {
  return process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'
}

export function buildDirectorSystemPrompt(): string {
  return [
    'You are an art director for Kemuma Carvings, a shop of one-of-a-kind vintage hand-carved Kisii soapstone.',
    'You write the product-specific sections of a GPT Image 2 staging prompt. The scene and lighting sections',
    'are fixed by a template; you write SUBJECT AND COUNT, COMPOSITION, and PRODUCT LOCK, plus optional extra exclusions.',
    'Rules:',
    '- Study the reference photo first. Describe only visually supported, identity-critical characteristics:',
    '  silhouette, proportions, edge shape, carving and artwork placement, banding, veining, mottling,',
    '  color variation, wear, chips, asymmetries.',
    '- The photo controls appearance; the structured record controls dimensions and scale. On any conflict the',
    '  photo wins; never invent a reconciliation, motif, accessory, or unseen feature.',
    '- State exact counts with the word "exactly": the number of sets and the number of constituent pieces',
    '  visible in the photo. Every physical piece appears once.',
    '- Never request a viewpoint, surface, or side the reference photos do not show, individually or',
    '  together. With a single reference, keep its facing orientation; with several views, new angles',
    '  are allowed when every visible surface is covered by some reference.',
    '- Keep the product large enough in frame to verify its carvings. No occlusion by props.',
    '- PRODUCT LOCK must open with the exact sentence "Use the exact physical product from Image 1." and end',
    '  with the exact sentence "Do not restyle, redraw, smooth, or symmetrize."',
    '- Concrete visual language only, no marketing adjectives. Two to four sentences per section.',
  ].join('\n')
}

export function buildDirectorUserText(input: {
  name: string
  family: string
  colorway: string
  height_in: number
  width_in: number
  depth_in: number
  quantity: number
  scene: SceneTemplate
  stagingNotes?: string
}): string {
  return [
    `Product: ${input.name} (${input.family}), ${input.colorway} colorway.`,
    `Dimensions: ${input.height_in} in H x ${input.width_in} in W x ${input.depth_in} in D.`,
    `Record quantity: ${input.quantity}. A quantity above 1 means identical copies exist in stock;`,
    'still stage exactly what the one reference photo shows.',
    `It will be placed in this scene: "${input.scene.label}". ${input.scene.scene}`,
    'The reference photo follows. Count the pieces visible in it and use that exact count.',
    ...(input.stagingNotes ? [`Owner's staging notes for this design: ${input.stagingNotes}`] : []),
  ].join('\n')
}

export function buildVarianceDirectorUserText(input: {
  name: string
  family: string
  colorway: string
  height_in: number
  width_in: number
  depth_in: number
  quantity: number
  scene: SceneTemplate
  referenceCount: number
  stagingNotes?: string
}): string {
  return [
    `Product: ${input.name} (${input.family}), ${input.colorway} colorway.`,
    `Dimensions: ${input.height_in} in H x ${input.width_in} in W x ${input.depth_in} in D.`,
    `Record quantity: ${input.quantity}. A quantity above 1 means identical copies exist in stock;`,
    'still stage exactly what one product shows.',
    `It will be placed in this scene: "${input.scene.label}". ${input.scene.scene}`,
    `The next ${input.referenceCount} photos are different views of the same physical product; use them together`,
    'to understand its full geometry. Count the constituent pieces and use that exact count.',
    'Write four different compositions, one per candidate image. Vary the arrangement, viewing angle,',
    'ordering, and crop between them, keeping every pose supported by what the photos show.',
    ...(input.stagingNotes ? [`Owner's staging notes for this design: ${input.stagingNotes}`] : []),
  ].join('\n')
}

export interface ArtDirector {
  label: string
  direct(
    userText: string,
    image: ApiImageBlock
  ): Promise<{ direction: ArtDirection; input_tokens: number; output_tokens: number }>
  directVaried(
    userText: string,
    images: ApiImageBlock[]
  ): Promise<{ direction: VariedArtDirection; input_tokens: number; output_tokens: number }>
}

export function createClaudeArtDirector(): ArtDirector {
  const client = new Anthropic()
  const model = artDirectorModel()
  return {
    label: model,
    async direct(userText, image) {
      const response = await client.messages.parse({
        model,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        system: buildDirectorSystemPrompt(),
        messages: [{ role: 'user', content: [image, { type: 'text', text: userText }] }],
        output_config: { format: zodOutputFormat(ArtDirectionSchema) },
      })
      if (!response.parsed_output) {
        throw new Error(`art director returned no parsed output (stop_reason: ${response.stop_reason})`)
      }
      return {
        direction: response.parsed_output,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      }
    },
    async directVaried(userText, images) {
      const response = await client.messages.parse({
        model,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        system: buildDirectorSystemPrompt(),
        messages: [{ role: 'user', content: [...images, { type: 'text', text: userText }] }],
        output_config: { format: zodOutputFormat(VariedArtDirectionSchema) },
      })
      if (!response.parsed_output) {
        throw new Error(`art director returned no parsed output (stop_reason: ${response.stop_reason})`)
      }
      return {
        direction: response.parsed_output,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      }
    },
  }
}
