import type { Db } from '@/lib/catalog/db'
import { getDesignDetail, getPhotoPath } from '@/lib/catalog/catalog'
import { setPendingPlan, setStagingNotes, stagingNotesForDesign } from '@/lib/catalog/chats'
import { listStagedForDesign } from '@/lib/catalog/staged'
import { imageToApiBlock } from '@/lib/images/prepare'
import type { ApiImageBlock } from '@/lib/writer/generate'
import { scenesForFamily } from './scenes'
import { StagingPlanSchema, validatePlan } from './plan'

export type ToolResultContent = Array<{ type: 'text'; text: string } | ApiImageBlock>

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
        scene: { type: 'string' as const },
        lighting: { type: 'string' as const },
        subject_and_count: { type: 'string' as const },
        composition: { type: 'string' as const },
        product_lock: { type: 'string' as const },
        extra_exclusions: { type: 'array' as const, items: { type: 'string' as const } },
        size: { type: 'string' as const, enum: ['1536x1024', '1024x1536'] },
        reference_photo_ids: { type: 'array' as const, items: { type: 'number' as const } },
        n: { type: 'number' as const },
      },
      required: ['scene', 'lighting', 'subject_and_count', 'composition', 'product_lock', 'extra_exclusions', 'size', 'reference_photo_ids'],
      additionalProperties: false,
    },
  },
]

function text(t: string): ToolResultContent {
  return [{ type: 'text', text: t }]
}

export async function executeAgentTool(
  db: Db,
  ctx: { designId: number; chatId: number },
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
      const parsed = StagingPlanSchema.safeParse(input)
      if (!parsed.success) return text(`plan rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
      const errors = validatePlan(db, ctx.designId, parsed.data)
      if (errors.length > 0) return text(`plan rejected, fix and call plan_batch again:\n- ${errors.join('\n- ')}`)
      setPendingPlan(db, ctx.chatId, JSON.stringify(parsed.data))
      return text('plan saved. Tell the user what you set up; they will click Generate to run it.')
    }
    default:
      return text(`unknown tool "${name}"`)
  }
}
