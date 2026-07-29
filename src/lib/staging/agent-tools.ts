import type { Db } from '@/lib/catalog/db'
import { getDesignDetail, getPhotoPath } from '@/lib/catalog/catalog'
import { setPendingPlan, setStagingNotes, stagingNotesForDesign } from '@/lib/catalog/chats'
import { listStagedForDesign } from '@/lib/catalog/staged'
import { imageToApiBlock } from '@/lib/images/prepare'
import type { ApiImageBlock } from '@/lib/writer/generate'
import { scenesForFamily } from './scenes'
import { StagingPlanSchema, validatePlan } from './plan'

export type ToolResultContent = Array<{ type: 'text'; text: string } | ApiImageBlock>

/* Per-run state, so the tool can tell a first refusal from a loop. Eight
   director runs in the catalogue rejected their own plan over and over, worst
   case thirteen times, because every refusal ended by inviting another try and
   nothing counted. */
export type AgentToolCtx = { designId: number; chatId: number; planRejections?: number }

/* Retries offered, not rejections tolerated: the fourth refusal is the one that
   stops asking. Three is enough to fix a fumbled field and not enough to burn
   three minutes. Past this the run is not converging and saying "try again" is
   the bug. */
export const PLAN_RETRY_LIMIT = 3

export function planRefusalReason(body: string): string {
  const rules = body
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2))
    .join('; ')
  return rules || body
}

export const AGENT_TOOLS = [
  {
    name: 'view_design',
    description: 'Read the catalog record for this design: name, family, notes, pieces with dimensions and colorways, photo ids, and the owner staging notes.',
    input_schema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'view_photos',
    description: 'Look at up to four photos of this design by photo_id. Always look before planning a scene.',
    input_schema: {
      type: 'object' as const,
      properties: { photo_ids: { type: 'array' as const, items: { type: 'number' as const } } },
      required: ['photo_ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_scenes',
    description: 'List the preset scene templates for this design family as starting points for scene and lighting language.',
    input_schema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'review_history',
    description: 'List previous staged batches for this design: scene, status (approved means the owner liked it), destination, and prompt excerpt.',
    input_schema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'save_staging_note',
    description: 'Save a durable fact about how this piece should be staged (what it holds, its story, owner preferences). Overwrites the existing note, so include everything still true.',
    input_schema: {
      type: 'object' as const,
      properties: { note: { type: 'string' as const } },
      required: ['note'],
      additionalProperties: false,
    },
  },
  {
    name: 'plan_batch',
    description: 'Store the staging plan for the user to execute. Returns validation errors to fix, or confirmation. This does NOT generate images; the user clicks Generate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scene: {
          type: 'string' as const,
          description: 'The room, surface, mood and any props, described concretely. Props live here, not in counts.',
        },
        lighting: {
          type: 'string' as const,
          description:
            "This scene's own light: direction, quality, colour temperature, and the contact shadows that ground the piece. The mandatory never-composited sentence is added for you, so do not write it.",
        },
        counts: {
          type: 'array' as const,
          description:
            'The PRODUCT only, split into its distinct parts, with how many of each. A coaster set is [{"n":1,"what":"soapstone holder"},{"n":6,"what":"coasters"}]. Scenery and props do NOT go here. At most 4 entries. The count sentence is written for you.',
          items: {
            type: 'object' as const,
            properties: {
              n: { type: 'number' as const, description: 'How many of this part appear.' },
              what: {
                type: 'string' as const,
                description:
                  'A bare noun phrase, like "soapstone holder". No number, no article, and never the word "exactly".',
              },
            },
            required: ['n', 'what'],
            additionalProperties: false,
          },
        },
        arrangement: {
          type: 'string' as const,
          description: 'How the product sits: what faces the camera, what is stacked or fanned, where props sit relative to it.',
        },
        composition: {
          type: 'string' as const,
          description: 'Framing and camera angle, citing the real dimensions so the piece is scaled correctly.',
        },
        product_lock: {
          type: 'string' as const,
          description:
            'Only the identity-critical features actually visible in the photo: silhouette, carving, banding, veining, wear, asymmetries. The opening and closing lock sentences are added for you, so write only the middle.',
        },
        extra_exclusions: {
          type: 'array' as const,
          description: 'At most 4 extra things to ban, beyond the standard exclusions already added for you.',
          items: { type: 'string' as const },
        },
        size: {
          type: 'string' as const,
          enum: ['1536x1024', '1024x1536'],
          description: 'Landscape for scenes, portrait for tall pieces.',
        },
        reference_photo_ids: {
          type: 'array' as const,
          description: 'At most 3 photo ids of THIS design, best view first.',
          items: { type: 'number' as const },
        },
        n: { type: 'number' as const, description: 'How many images to generate, 1 to 4.' },
      },
      required: ['scene', 'lighting', 'counts', 'arrangement', 'composition', 'product_lock', 'extra_exclusions', 'size', 'reference_photo_ids'],
      additionalProperties: false,
    },
  },
]

function text(t: string): ToolResultContent {
  return [{ type: 'text', text: t }]
}

export async function executeAgentTool(
  db: Db,
  ctx: AgentToolCtx,
  name: string,
  input: unknown
): Promise<ToolResultContent> {
  const detail = getDesignDetail(db, ctx.designId)
  if (!detail) return text(`design ${ctx.designId} not found`)

  switch (name) {
    case 'view_design': {
      const notes = stagingNotesForDesign(db, ctx.designId)
      return text(
        JSON.stringify(
          {
            design_id: detail.design_id,
            name: detail.name,
            family: detail.family,
            notes: detail.notes,
            staging_notes: notes,
            pieces: detail.pieces.map((p) => ({
              piece_id: p.piece_id,
              colorway: p.colorway,
              height_in: p.height_in,
              width_in: p.width_in,
              depth_in: p.depth_in,
              photo_ids: p.photos.map((ph) => ph.photo_id),
            })),
          },
          null,
          2
        )
      )
    }
    case 'view_photos': {
      const ids = ((input as { photo_ids?: number[] }).photo_ids ?? []).slice(0, 4)
      const owned = new Set(detail.pieces.flatMap((p) => p.photos.map((ph) => ph.photo_id)))
      const out: ToolResultContent = []
      for (const id of ids) {
        if (!owned.has(id)) {
          out.push({ type: 'text', text: `photo ${id} is not a photo of this design` })
          continue
        }
        const file = getPhotoPath(db, id)
        if (!file) {
          out.push({ type: 'text', text: `photo ${id} has no file` })
          continue
        }
        out.push({ type: 'text', text: `photo ${id}:` })
        out.push(await imageToApiBlock(file))
      }
      return out.length > 0 ? out : text('no photos requested')
    }
    case 'list_scenes': {
      try {
        const scenes = scenesForFamily(detail.family)
        return text(
          scenes
            .map((s) => `${s.key} (${s.label}, ${s.size})\nSCENE: ${s.scene}\nLIGHTING: ${s.lighting}`)
            .join('\n\n')
        )
      } catch {
        return text(`no preset scenes for family "${detail.family}"`)
      }
    }
    case 'review_history': {
      const rows = listStagedForDesign(db, ctx.designId).slice(0, 12)
      if (rows.length === 0) return text('no staged batches yet')
      return text(
        rows
          .map(
            (r) =>
              `staged ${r.staged_id}: scene=${r.scene_key} status=${r.status}${r.destination ? ` destination=${r.destination}` : ''}\nprompt excerpt: ${r.prompt.slice(0, 220)}`
          )
          .join('\n\n')
      )
    }
    case 'save_staging_note': {
      const note = String((input as { note?: string }).note ?? '').trim()
      if (!note) return text('note was empty; nothing saved')
      setStagingNotes(db, ctx.chatId, note)
      return text('staging note saved')
    }
    case 'plan_batch': {
      const refuse = (reasons: string[]): ToolResultContent => {
        ctx.planRejections = (ctx.planRejections ?? 0) + 1
        const why = reasons.map((r) => `- ${r}`).join('\n')
        if (ctx.planRejections > PLAN_RETRY_LIMIT) {
          return text(
            `plan rejected ${ctx.planRejections} times. Stop calling plan_batch and tell the owner the batch could not be planned, quoting this:\n${why}`
          )
        }
        return text(`plan rejected, fix and call plan_batch again:\n${why}`)
      }
      const parsed = StagingPlanSchema.safeParse(input)
      // Path first. A bare "expected array to have >=1 items" does not tell the
      // writer which field it fumbled, which is how a refusal turns into a loop.
      if (!parsed.success) {
        return refuse(parsed.error.issues.map((i) => `${i.path.join('.') || 'plan'}: ${i.message}`))
      }
      const errors = validatePlan(db, ctx.designId, parsed.data)
      if (errors.length > 0) return refuse(errors)
      setPendingPlan(db, ctx.chatId, JSON.stringify(parsed.data))
      return text('plan saved. Tell the user what you set up; they will click Generate to run it.')
    }
    default:
      return text(`unknown tool "${name}"`)
  }
}
