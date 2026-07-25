import type { query } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClaudeSdkMatcher } from '@/lib/matcher/match-claude-sdk'
import type { ApiImageBlock } from '@/lib/writer/generate'

type QueryParams = Parameters<typeof query>[0]

function image(data: string): ApiImageBlock {
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }
}

function fakeQuery(
  result: unknown,
  capture: { params?: QueryParams; promptMessages?: unknown[] }
): typeof query {
  return ((params: QueryParams) => {
    capture.params = params
    return (async function* () {
      capture.promptMessages = []
      for await (const message of params.prompt as AsyncIterable<unknown>) {
        capture.promptMessages.push(message)
      }
      yield result
    })()
  }) as unknown as typeof query
}

function success(structured_output?: unknown) {
  return {
    type: 'result',
    subtype: 'success',
    structured_output,
    usage: { input_tokens: 31, output_tokens: 12 },
  }
}

describe('createClaudeSdkMatcher', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('scrubs API credentials and sends vision through an isolated streamed query', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'live-api-key')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'live-auth-token')
    const capture: { params?: QueryParams; promptMessages?: unknown[] } = {}
    const matcher = createClaudeSdkMatcher({
      model: 'claude-test',
      queryFn: fakeQuery(
        success({
          decision: 'existing',
          design_id: 42,
          confidence: 'high',
          evidence: 'The carved silhouettes match.',
        }),
        capture
      ),
    })

    const proposal = await matcher.match([image('candidate')], [image('new')], 'lineup text')

    expect(proposal.design_id).toBe(42)
    const options = capture.params!.options!
    expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(options.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(options).toMatchObject({
      model: 'claude-test',
      settingSources: [],
      strictMcpConfig: true,
      permissionMode: 'bypassPermissions',
      allowedTools: [],
      tools: [],
    })
    expect(options.outputFormat).toMatchObject({
      type: 'json_schema',
      schema: { $schema: 'http://json-schema.org/draft-07/schema#' },
    })
    expect(capture.promptMessages).toEqual([
      {
        type: 'user',
        session_id: '',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            image('candidate'),
            image('new'),
            { type: 'text', text: 'lineup text' },
          ],
        },
      },
    ])
  })

  it.each([undefined, null])('rejects a success result with no structured output (%s)', async (value) => {
    const matcher = createClaudeSdkMatcher({ queryFn: fakeQuery(success(value), {}) })

    await expect(matcher.match([], [], 'lineup text')).rejects.toThrow(/success.*no structured_output/i)
  })

  it('rejects exhausted structured-output retries', async () => {
    const matcher = createClaudeSdkMatcher({
      queryFn: fakeQuery(
        {
          type: 'result',
          subtype: 'error_max_structured_output_retries',
          errors: ['schema mismatch'],
          usage: { input_tokens: 31, output_tokens: 12 },
        },
        {}
      ),
    })

    await expect(matcher.match([], [], 'lineup text')).rejects.toThrow(
      /structured output retries.*schema mismatch/i
    )
  })
})
