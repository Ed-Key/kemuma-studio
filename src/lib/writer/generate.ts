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

export interface ComparableListing {
  design_id: number
  name: string
  family: string
  price_usd: number
  height_in: number | null
  width_in: number | null
  depth_in: number | null
  weight_lb: number | null
  description: string
  photoPaths: string[]
}

export interface WriterContext {
  comparables: ComparableListing[]
}

export interface ListingWriter {
  label: string
  write(system: string, user: string, images: ApiImageBlock[], context?: WriterContext): Promise<WriterOutput>
}

export function writerModel(): string {
  return process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'
}

const VIEW_COMPARABLE_TOOL = {
  name: 'view_comparable',
  description:
    'Inspect an approved catalog listing before pricing: returns its photos, price, dimensions, and description. Call this for the comparables most similar to the new piece so your price_justification cites evidence you actually looked at.',
  input_schema: {
    type: 'object' as const,
    properties: {
      design_id: { type: 'number' as const, description: 'design_id from the comparables list in the prompt' },
    },
    required: ['design_id'],
    additionalProperties: false,
  },
}

async function comparableToolResult(comp: ComparableListing | undefined, designId: number) {
  if (!comp) return [{ type: 'text' as const, text: `no comparable with design_id ${designId}` }]
  const images = []
  for (const p of comp.photoPaths.slice(0, 2)) images.push(await imageToApiBlock(p))
  return [
    {
      type: 'text' as const,
      text: `${comp.name} (${comp.family}) sells for $${comp.price_usd}; ${comp.height_in}"H x ${comp.width_in}"W x ${comp.depth_in}"D, ${comp.weight_lb} lb.\nListing description:\n${comp.description.slice(0, 600)}`,
    },
    ...images,
  ]
}

export function createClaudeWriter(model?: string): ListingWriter {
  const client = new Anthropic()
  const resolved = model ?? writerModel()

  async function singleShot(system: string, user: string, images: ApiImageBlock[]): Promise<WriterOutput> {
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
  }

  // Agentic path (Ed's design, 2026-07-24): the writer can call view_comparable
  // to look at approved listings' photos before pricing, instead of pricing
  // from attribute text alone.
  async function agentic(
    system: string,
    user: string,
    images: ApiImageBlock[],
    comparables: ComparableListing[]
  ): Promise<WriterOutput> {
    let totalIn = 0
    let totalOut = 0
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: [...images, { type: 'text', text: user }] },
    ]
    for (let turn = 0; turn < 6; turn++) {
      const response = await client.messages.create({
        model: resolved,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system,
        tools: [VIEW_COMPARABLE_TOOL],
        messages,
        output_config: { format: zodOutputFormat(ListingDraftSchema) },
      })
      totalIn += response.usage.input_tokens
      totalOut += response.usage.output_tokens

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content })
        const results: Anthropic.ToolResultBlockParam[] = []
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          const designId = Number((block.input as { design_id?: number }).design_id)
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: await comparableToolResult(
              comparables.find((c) => c.design_id === designId),
              designId
            ),
          })
        }
        messages.push({ role: 'user', content: results })
        continue
      }

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      const draft = ListingDraftSchema.parse(JSON.parse(text))
      return { draft, input_tokens: totalIn, output_tokens: totalOut }
    }
    throw new Error('agentic writer exceeded its tool-loop limit')
  }

  return {
    label: resolved,
    async write(system, user, images, context) {
      if (context && context.comparables.length > 0) {
        return agentic(system, user, images, context.comparables)
      }
      return singleShot(system, user, images)
    },
  }
}

// Ed's design (2026-07-24): the writer sees what the catalog sells for AND can
// inspect comparables' photos via the view_comparable tool before pricing.
export function loadComparables(db: Db, excludeDesignId: number): ComparableListing[] {
  const rows = db
    .prepare(`
      SELECT ds.design_id, ds.name, ds.family,
             CAST(json_extract(d.final_json, '$.price_usd') AS REAL) AS price_usd,
             json_extract(d.final_json, '$.description') AS description,
             MAX(p.height_in) AS height_in, MAX(p.width_in) AS width_in,
             MAX(p.depth_in) AS depth_in, MAX(p.weight_lb) AS weight_lb
      FROM drafts d
      JOIN designs ds ON ds.design_id = d.design_id
      LEFT JOIN pieces p ON p.design_id = ds.design_id
      WHERE d.status = 'approved' AND d.final_json IS NOT NULL AND d.design_id != ?
      GROUP BY d.draft_id
      ORDER BY ds.family, ds.name
    `)
    .all(excludeDesignId) as Array<Omit<ComparableListing, 'photoPaths'>>
  const photoStmt = db.prepare(`
    SELECT ph.file_path FROM photos ph
    JOIN pieces p ON p.piece_id = ph.piece_id
    WHERE p.design_id = ? ORDER BY ph.photo_id LIMIT 2
  `)
  return rows.map((r) => ({
    ...r,
    photoPaths: (photoStmt.all(r.design_id) as Array<{ file_path: string }>).map((x) => x.file_path),
  }))
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

  const comparables = loadComparables(db, designId)
  const system = buildSystemPrompt()
  const user = buildUserPrompt(detail, comparables)

  let totalIn = 0
  let totalOut = 0
  const context: WriterContext = { comparables }
  let out = await writer.write(system, user, images, context)
  totalIn += out.input_tokens
  totalOut += out.output_tokens
  let errors = validateEtsyRules(out.draft)
  if (errors.length > 0) {
    const feedback = `${user}\n\nYour previous draft violated these Etsy rules; fix them:\n- ${errors.join('\n- ')}`
    out = await writer.write(system, feedback, images, context)
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
