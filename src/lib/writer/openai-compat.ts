import type { ApiImageBlock, ListingWriter, WriterOutput } from './generate'
import { ListingDraftSchema } from './schema'

// Hand-written JSON schema mirroring ListingDraftSchema, in the strict
// subset OpenAI-compatible providers accept.
const LISTING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 13, maxItems: 13 },
    price_usd: { type: 'number' },
    price_justification: { type: 'string' },
    materials: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 13 },
    colorway_notes: { type: 'string' },
  },
  required: ['title', 'description', 'tags', 'price_usd', 'price_justification', 'materials', 'colorway_notes'],
  additionalProperties: false,
} as const

export function createOpenAICompatWriter(opts: {
  label: string
  baseUrl: string
  apiKey: string
  model: string
  fetchFn?: typeof fetch
}): ListingWriter {
  const fetchFn = opts.fetchFn ?? fetch
  return {
    label: opts.label,
    async write(system, user, images): Promise<WriterOutput> {
      const res = await fetchFn(`${opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: 8000,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                ...images.map((img: ApiImageBlock) => ({
                  type: 'image_url',
                  image_url: { url: `data:${img.source.media_type};base64,${img.source.data}` },
                })),
                { type: 'text', text: user },
              ],
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'listing_draft', strict: true, schema: LISTING_JSON_SCHEMA },
          },
        }),
      })
      if (!res.ok) throw new Error(`${opts.label} api ${res.status}: ${await res.text()}`)
      const json = (await res.json()) as {
        choices: Array<{ message: { content: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const draft = ListingDraftSchema.parse(JSON.parse(json.choices[0].message.content))
      return {
        draft,
        input_tokens: json.usage?.prompt_tokens ?? 0,
        output_tokens: json.usage?.completion_tokens ?? 0,
      }
    },
  }
}
