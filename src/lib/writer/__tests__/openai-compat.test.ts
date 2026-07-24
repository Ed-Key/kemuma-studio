import { describe, it, expect, vi } from 'vitest'
import { createOpenAICompatWriter } from '@/lib/writer/openai-compat'

const DRAFT = {
  title: 'Vintage Kenyan Soapstone Coaster Set',
  description: 'd',
  tags: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12', 't13'],
  price_usd: 49,
  materials: ['soapstone'],
  colorway_notes: 'blue',
}

function okResponse() {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(DRAFT) } }],
      usage: { prompt_tokens: 111, completion_tokens: 22 },
    }),
  } as unknown as Response
}

describe('createOpenAICompatWriter', () => {
  const image = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: 'abc123' } }

  it('sends a chat completion with data-url images and a strict json schema', async () => {
    const fetchFn = vi.fn(async () => okResponse())
    const writer = createOpenAICompatWriter({
      label: 'gemini:gemini-2.5-flash', baseUrl: 'https://example.test/v1', apiKey: 'key9', model: 'gemini-2.5-flash',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const out = await writer.write('sys', 'usr', [image])
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.test/v1/chat/completions')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer key9')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gemini-2.5-flash')
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(body.messages[1].content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc123' } })
    expect(body.messages[1].content[1]).toEqual({ type: 'text', text: 'usr' })
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(out.draft.title).toBe(DRAFT.title)
    expect(out.input_tokens).toBe(111)
    expect(out.output_tokens).toBe(22)
    expect(writer.label).toBe('gemini:gemini-2.5-flash')
  })

  it('throws with status and body on http failure', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' }) as unknown as Response)
    const writer = createOpenAICompatWriter({
      label: 'x', baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    await expect(writer.write('s', 'u', [])).rejects.toThrow(/429.*rate limited/s)
  })

  it('rejects malformed model output via the zod schema', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true, status: 200, text: async () => '',
      json: async () => ({ choices: [{ message: { content: '{"title":"only a title"}' } }], usage: {} }),
    }) as unknown as Response)
    const writer = createOpenAICompatWriter({
      label: 'x', baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    await expect(writer.write('s', 'u', [])).rejects.toThrow()
  })
})
