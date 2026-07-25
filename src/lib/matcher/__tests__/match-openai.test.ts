import { afterEach, describe, expect, it, vi } from 'vitest'
import { matcherModel } from '@/lib/matcher/match'
import { createOpenAIMatcher, DEFAULT_MATCHER_MODEL, defaultMatcher } from '@/lib/matcher/match-openai'
import type { ApiImageBlock } from '@/lib/writer/generate'

function image(data: string, media_type: 'image/jpeg' | 'image/png' = 'image/jpeg'): ApiImageBlock {
  return { type: 'image', source: { type: 'base64', media_type, data } } as unknown as ApiImageBlock
}

function okResponse(content: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 21, completion_tokens: 8 },
    }),
  } as unknown as Response
}

describe('createOpenAIMatcher', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends candidate images before new images and text with a strict match schema', async () => {
    const fetchFn = vi.fn(async () =>
      okResponse({
        decision: 'existing',
        design_id: 42,
        confidence: 'high',
        evidence: 'The carved silhouettes and proportions match.',
      })
    )
    const matcher = createOpenAIMatcher({
      model: 'gpt-test',
      apiKey: 'key9',
      baseUrl: 'https://example.test/v1',
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    const proposal = await matcher.match(
      [image('candidate-1'), image('candidate-2', 'image/png')],
      [image('new-1'), image('new-2')],
      'lineup text'
    )

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.test/v1/chat/completions')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-test')
    expect(body.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,candidate-1' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,candidate-2' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,new-1' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,new-2' } },
      { type: 'text', text: 'lineup text' },
    ])
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'match_proposal',
        strict: true,
        schema: {
          required: ['decision', 'design_id', 'confidence', 'evidence'],
          additionalProperties: false,
          properties: {
            design_id: { type: ['integer', 'null'] },
          },
        },
      },
    })
    expect(proposal).toEqual({
      decision: 'existing',
      design_id: 42,
      confidence: 'high',
      evidence: 'The carved silhouettes and proportions match.',
    })
  })

  it('rejects output that violates MatchProposalSchema', async () => {
    const fetchFn = vi.fn(async () =>
      okResponse({ decision: 'existing', design_id: 42, confidence: 'certain', evidence: 'same' })
    )
    const matcher = createOpenAIMatcher({
      apiKey: 'key9',
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    await expect(matcher.match([], [], 'lineup text')).rejects.toThrow()
  })

  it('reports the OpenAI default instead of a stale Anthropic model', () => {
    vi.stubEnv('MATCHER_MODEL', '')
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-stale')

    expect(matcherModel()).toBe(DEFAULT_MATCHER_MODEL)
  })

  it('selects the Claude subscription matcher by provider prefix', () => {
    vi.stubEnv('MATCHER_MODEL', 'claude-sub:claude-test')

    const matcher = defaultMatcher()

    expect(matcher.match).toBeTypeOf('function')
  })
})
