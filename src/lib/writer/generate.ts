import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { Db } from '@/lib/catalog/db'
import { getDesignDetail, getPhotoPath } from '@/lib/catalog/catalog'
import { createDraft } from '@/lib/catalog/drafts'
import { imageToApiBlock } from '@/lib/images/prepare'
import { ListingDraftSchema, validateEtsyRules, type ListingDraft } from './schema'
import { buildSystemPrompt, buildUserPrompt } from './prompt'

export type ApiImageBlock = Awaited<ReturnType<typeof imageToApiBlock>>

export interface ListingWriter {
  write(system: string, user: string, images: ApiImageBlock[]): Promise<ListingDraft>
}

export function writerModel(): string {
  return process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'
}

export function createClaudeWriter(): ListingWriter {
  const client = new Anthropic()
  return {
    async write(system, user, images) {
      const response = await client.messages.parse({
        model: writerModel(),
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system,
        messages: [{ role: 'user', content: [...images, { type: 'text', text: user }] }],
        output_config: { format: zodOutputFormat(ListingDraftSchema) },
      })
      if (!response.parsed_output) {
        throw new Error(`writer returned no parsed output (stop_reason: ${response.stop_reason})`)
      }
      return response.parsed_output
    },
  }
}

export async function generateDraft(
  db: Db,
  writer: ListingWriter,
  designId: number,
  maxImages = 6
): Promise<number> {
  const detail = getDesignDetail(db, designId)
  if (!detail) throw new Error(`design ${designId} not found`)

  // Round-robin across pieces so multi-colorway designs show every colorway
  // to the model instead of six shots of the first piece.
  const byPiece = detail.pieces.map((p) => p.photos.map((ph) => ph.photo_id))
  const photoIds: number[] = []
  for (let round = 0; photoIds.length < maxImages; round++) {
    let added = false
    for (const list of byPiece) {
      if (list[round] !== undefined && photoIds.length < maxImages) {
        photoIds.push(list[round])
        added = true
      }
    }
    if (!added) break
  }
  const images: ApiImageBlock[] = []
  for (const id of photoIds) {
    const file = getPhotoPath(db, id)
    if (file) images.push(await imageToApiBlock(file))
  }

  const system = buildSystemPrompt()
  const user = buildUserPrompt(detail)

  let draft = await writer.write(system, user, images)
  let errors = validateEtsyRules(draft)
  if (errors.length > 0) {
    const feedback = `${user}\n\nYour previous draft violated these Etsy rules; fix them:\n- ${errors.join('\n- ')}`
    draft = await writer.write(system, feedback, images)
    errors = validateEtsyRules(draft)
    if (errors.length > 0) throw new Error(`draft failed validation after retry: ${errors.join('; ')}`)
  }

  return createDraft(db, { design_id: designId, generated_json: JSON.stringify(draft), model: writerModel() })
}
