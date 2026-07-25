import { describe, expect, it, vi } from 'vitest'
import { createOpenAIAgentClient } from '@/lib/staging/agent-openai'
import { AGENT_TOOLS } from '@/lib/staging/agent-tools'

function okResponse(message: unknown, usage = { prompt_tokens: 31, completion_tokens: 12 }) {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ choices: [{ message }], usage }),
  } as unknown as Response
}

describe('createOpenAIAgentClient', () => {
  it('round trips tool calls and sends the tool result back in OpenAI format', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          content: 'Looking now.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'view_design', arguments: '{"include_notes":true}' },
            },
          ],
        })
      )
      .mockResolvedValueOnce(okResponse({ content: 'The design is ready.' }))
    const client = createOpenAIAgentClient({
      model: 'gpt-test',
      apiKey: 'key9',
      baseUrl: 'https://example.test/v1',
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    const first = await client.messages.create({
      model: 'ignored-anthropic-model',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: 'system rules',
      tools: AGENT_TOOLS,
      messages: [{ role: 'user', content: 'show me the design' }],
    })

    expect(first).toEqual({
      stop_reason: 'tool_use',
      usage: { input_tokens: 31, output_tokens: 12 },
      content: [
        { type: 'text', text: 'Looking now.' },
        { type: 'tool_use', id: 'call_1', name: 'view_design', input: { include_notes: true } },
      ],
    })

    await client.messages.create({
      model: 'ignored-anthropic-model',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: 'system rules',
      tools: AGENT_TOOLS,
      messages: [
        { role: 'user', content: 'show me the design' },
        { role: 'assistant', content: first.content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              content: [{ type: 'text', text: '{"name":"Canoe Trinket Dish"}' }],
            },
          ],
        },
      ],
    })

    const firstBody = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(firstBody.model).toBe('gpt-test')
    expect(firstBody.max_completion_tokens).toBe(8000)
    expect(firstBody).not.toHaveProperty('thinking')
    expect(firstBody.messages[0]).toEqual({ role: 'system', content: 'system rules' })
    expect(firstBody.tools[0]).toEqual({
      type: 'function',
      function: {
        name: AGENT_TOOLS[0].name,
        description: AGENT_TOOLS[0].description,
        parameters: AGENT_TOOLS[0].input_schema,
      },
    })

    const secondBody = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    expect(secondBody.messages.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: 'Looking now.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'view_design', arguments: '{"include_notes":true}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: [{ type: 'text', text: '{"name":"Canoe Trinket Dish"}' }],
      },
    ])
  })

  it('fans multiple tool results out to one ordered message per result', async () => {
    const fetchFn = vi.fn(async () => okResponse({ content: 'done' }))
    const client = createOpenAIAgentClient({
      apiKey: 'key9',
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    await client.messages.create({
      system: 'system rules',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: 'first result' },
            { type: 'tool_result', tool_use_id: 'call_2', content: 'second result' },
          ],
        },
      ],
    })

    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([
      { role: 'system', content: 'system rules' },
      { role: 'tool', tool_call_id: 'call_1', content: 'first result' },
      { role: 'tool', tool_call_id: 'call_2', content: 'second result' },
    ])
  })

  it('moves tool-result images into a following OpenAI user image message', async () => {
    const fetchFn = vi.fn(async () => okResponse({ content: 'done' }))
    const client = createOpenAIAgentClient({
      apiKey: 'key9',
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    await client.messages.create({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_photos',
              content: [
                { type: 'text', text: 'photo 7:' },
                {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/jpeg', data: 'photo-data' },
                },
              ],
            },
          ],
        },
      ],
    })

    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call_photos',
        content: [{ type: 'text', text: 'photo 7:' }],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Images returned by tool call call_photos:' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,photo-data' } },
        ],
      },
    ])
  })

  it('throws a clear error naming the tool when arguments are malformed', async () => {
    const fetchFn = vi.fn(async () =>
      okResponse({
        content: null,
        tool_calls: [
          {
            id: 'call_bad',
            type: 'function',
            function: { name: 'plan_batch', arguments: '{"scene":' },
          },
        ],
      })
    )
    const client = createOpenAIAgentClient({
      apiKey: 'key9',
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    await expect(client.messages.create({ messages: [] })).rejects.toThrow(/plan_batch.*arguments.*JSON/i)
  })
})
