import type { ApiImageBlock } from '@/lib/writer/generate'
import { ArtDirectionSchema, VariedArtDirectionSchema, buildDirectorSystemPrompt, type ArtDirector } from './direct'

// Hand-written JSON schemas mirroring the zod ones, in the strict subset
// OpenAI accepts: every property required, no additionalProperties, and
// arrays instead of tuples.
const DIRECTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    subject_and_count: { type: 'string' },
    composition: { type: 'string' },
    product_lock: { type: 'string' },
    extra_exclusions: { type: 'array', items: { type: 'string' }, maxItems: 4 },
  },
  required: ['subject_and_count', 'composition', 'product_lock', 'extra_exclusions'],
  additionalProperties: false,
} as const

const VARIED_JSON_SCHEMA = {
  type: 'object',
  properties: {
    subject_and_count: { type: 'string' },
    product_lock: { type: 'string' },
    extra_exclusions: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    compositions: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
  },
  required: ['subject_and_count', 'product_lock', 'extra_exclusions', 'compositions'],
  additionalProperties: false,
} as const

export const DEFAULT_ART_DIRECTOR_MODEL = 'gpt-5.1'

/**
 * The art director on OpenAI, so the whole staging pipeline bills one provider:
 * this model reads the reference photos and writes the product-specific prompt
 * sections, then gpt-image-2 paints from them. The guardrails that hold
 * fidelity (exact counts, relight language, the lock sentences) live in
 * validateStagingPrompt, not in the model, so they carry across providers
 * unchanged.
 */
export function createOpenAIArtDirector(opts?: {
  model?: string
  apiKey?: string
  baseUrl?: string
  fetchFn?: typeof fetch
}): ArtDirector {
  const model = opts?.model ?? process.env.ART_DIRECTOR_MODEL ?? DEFAULT_ART_DIRECTOR_MODEL
  const baseUrl = opts?.baseUrl ?? 'https://api.openai.com/v1'
  const fetchFn = opts?.fetchFn ?? fetch

  async function call<T>(
    userText: string,
    images: ApiImageBlock[],
    schemaName: string,
    schema: unknown
  ): Promise<{ parsed: T; input_tokens: number; output_tokens: number }> {
    const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildDirectorSystemPrompt() },
          {
            role: 'user',
            content: [
              ...images.map((img) => ({
                type: 'image_url',
                image_url: { url: `data:${img.source.media_type};base64,${img.source.data}` },
              })),
              { type: 'text', text: userText },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, strict: true, schema },
        },
      }),
    })
    if (!res.ok) throw new Error(`art director api ${res.status}: ${(await res.text()).slice(0, 400)}`)
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    return {
      parsed: JSON.parse(json.choices[0].message.content) as T,
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
    }
  }

  return {
    label: `openai:${model}`,
    async direct(userText, image) {
      const out = await call<unknown>(userText, [image], 'art_direction', DIRECTION_JSON_SCHEMA)
      return {
        direction: ArtDirectionSchema.parse(out.parsed),
        input_tokens: out.input_tokens,
        output_tokens: out.output_tokens,
      }
    },
    async directVaried(userText, images) {
      const out = await call<unknown>(userText, images, 'varied_art_direction', VARIED_JSON_SCHEMA)
      return {
        direction: VariedArtDirectionSchema.parse(out.parsed),
        input_tokens: out.input_tokens,
        output_tokens: out.output_tokens,
      }
    },
  }
}

/**
 * The studio's art director. Defaults to OpenAI so staging bills one provider
 * end to end (the same key already pays for gpt-image-2). Set
 * ART_DIRECTOR_MODEL to "anthropic:<model>" to go back to Claude.
 */
export function defaultArtDirector(): ArtDirector {
  const spec = process.env.ART_DIRECTOR_MODEL ?? ''
  if (spec.startsWith('anthropic:')) {
    // Lazy so the Anthropic SDK is never constructed unless asked for.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClaudeArtDirector } = require('./direct') as typeof import('./direct')
    return createClaudeArtDirector()
  }
  return createOpenAIArtDirector({ model: spec.startsWith('openai:') ? spec.slice('openai:'.length) : undefined })
}
