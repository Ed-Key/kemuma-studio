import type { ApiImageBlock } from '@/lib/writer/generate'
import { MatchProposalSchema } from './schema'
import { buildMatcherSystemPrompt, type DesignMatcher } from './match'
import { createClaudeSdkMatcher } from './match-claude-sdk'

// Hand-written JSON schema mirroring the zod one, in the strict subset
// OpenAI accepts: every property required and no additionalProperties.
const MATCH_PROPOSAL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['existing', 'new', 'abstain'] },
    design_id: { type: ['integer', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence: { type: 'string' },
    suggested_name: { type: ['string', 'null'] },
    suggested_family: { type: ['string', 'null'] },
  },
  required: ['decision', 'design_id', 'confidence', 'evidence', 'suggested_name', 'suggested_family'],
  additionalProperties: false,
} as const

export const DEFAULT_MATCHER_MODEL = 'gpt-5.1'

/**
 * The intake matcher on OpenAI. The candidate lineup must stay ahead of the
 * new-piece photos because the prompt assigns meaning by image position.
 */
export function createOpenAIMatcher(opts?: {
  model?: string
  apiKey?: string
  baseUrl?: string
  fetchFn?: typeof fetch
}): DesignMatcher {
  const model = opts?.model ?? process.env.MATCHER_MODEL ?? DEFAULT_MATCHER_MODEL
  const baseUrl = opts?.baseUrl ?? 'https://api.openai.com/v1'
  const fetchFn = opts?.fetchFn ?? fetch

  return {
    async match(candidateImages, newImages, userText) {
      const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
      const images: ApiImageBlock[] = [...candidateImages, ...newImages]
      const res = await fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: buildMatcherSystemPrompt() },
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
            json_schema: { name: 'match_proposal', strict: true, schema: MATCH_PROPOSAL_JSON_SCHEMA },
          },
        }),
      })
      if (!res.ok) throw new Error(`matcher api ${res.status}: ${(await res.text()).slice(0, 400)}`)
      const json = (await res.json()) as {
        choices: Array<{ message: { content: string } }>
      }
      return MatchProposalSchema.parse(JSON.parse(json.choices[0].message.content))
    },
  }
}

/**
 * The studio's intake matcher. Defaults to OpenAI so intake does not need an
 * Anthropic key. Set MATCHER_MODEL to "anthropic:<model>" to go back to Claude.
 */
export function defaultMatcher(): DesignMatcher {
  const spec = process.env.MATCHER_MODEL ?? ''
  if (spec.startsWith('claude-sub:')) {
    return createClaudeSdkMatcher({ model: spec.slice('claude-sub:'.length) || undefined })
  }
  if (spec.startsWith('anthropic:')) {
    // Lazy so the Anthropic SDK is never constructed unless asked for.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClaudeMatcher } = require('./match') as typeof import('./match')
    return createClaudeMatcher()
  }
  return createOpenAIMatcher({ model: spec.startsWith('openai:') ? spec.slice('openai:'.length) : undefined })
}
