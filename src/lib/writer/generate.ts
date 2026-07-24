import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { Db } from '@/lib/catalog/db'
import { getDesignDetail, getPhotoPath } from '@/lib/catalog/catalog'
import { createDraft } from '@/lib/catalog/drafts'
import { imageToApiBlock } from '@/lib/images/prepare'
import { ListingDraftSchema, validateEtsyRules, type ListingDraft } from './schema'
import { buildSystemPrompt, buildUserPrompt, type CatalogPriceRef } from './prompt'
import { computeCostUsd } from './prices'

export type ApiImageBlock = Awaited<ReturnType<typeof imageToApiBlock>>

export interface WriterOutput {
  draft: ListingDraft
  input_tokens: number
  output_tokens: number
}

export interface ListingWriter {
  label: string
  write(system: string, user: string, images: ApiImageBlock[]): Promise<WriterOutput>
}

export function writerModel(): string {
  return process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'
}

export function createClaudeWriter(model?: string): ListingWriter {
  const client = new Anthropic()
  const resolved = model ?? writerModel()
  return {
    label: resolved,
    async write(system, user, images) {
      const response = await client.messages.parse({
        model: resolved,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system,
        messages: [{ role: 'user', content: [...images, { type: 'text', text: user }] }],
        output_config: { format: zodOutputFormat(ListingDraftSchema) },
      })
      if (!response.parsed_output) {
        throw new Error(`writer returned no parsed output (stop_reason: ${response.stop_reason})`)
      }
      return {
        draft: response.parsed_output,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      }
    },
  }
}

// Ed's suggestion (2026-07-24): the writer should see what the rest of the
// catalog already sells for, so prices cohere instead of being per-listing
// model guesses.
export function loadCatalogPriceContext(db: Db, excludeDesignId: number): CatalogPriceRef[] {
  return db
    .prepare(`
      SELECT ds.name, ds.family, CAST(json_extract(d.final_json, '$.price_usd') AS REAL) AS price_usd
      FROM drafts d
      JOIN designs ds ON ds.design_id = d.design_id
      WHERE d.status = 'approved' AND d.final_json IS NOT NULL AND d.design_id != ?
      ORDER BY ds.family, ds.name
    `)
    .all(excludeDesignId) as CatalogPriceRef[]
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
  const user = buildUserPrompt(detail, loadCatalogPriceContext(db, designId))

  let totalIn = 0
  let totalOut = 0
  let out = await writer.write(system, user, images)
  totalIn += out.input_tokens
  totalOut += out.output_tokens
  let errors = validateEtsyRules(out.draft)
  if (errors.length > 0) {
    const feedback = `${user}\n\nYour previous draft violated these Etsy rules; fix them:\n- ${errors.join('\n- ')}`
    out = await writer.write(system, feedback, images)
    totalIn += out.input_tokens
    totalOut += out.output_tokens
    errors = validateEtsyRules(out.draft)
    if (errors.length > 0) throw new Error(`draft failed validation after retry: ${errors.join('; ')}`)
  }

  return createDraft(db, {
    design_id: designId,
    generated_json: JSON.stringify(out.draft),
    model: writer.label,
    usage_json: JSON.stringify({ input_tokens: totalIn, output_tokens: totalOut }),
    cost_usd: computeCostUsd(writer.label, totalIn, totalOut),
  })
}
