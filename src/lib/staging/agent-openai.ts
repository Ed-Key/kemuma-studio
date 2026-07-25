import type { StagingAgentClient } from './agent'

type AnthropicTool = {
  name: string
  description: string
  input_schema: unknown
}

type AnthropicMessage = {
  role: string
  content: unknown
}

type ContentBlock = {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  source?: {
    type?: string
    media_type?: string
    data?: string
  }
}

type OpenAIMessage = {
  role: string
  content: unknown
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export const DEFAULT_STAGING_AGENT_MODEL = 'gpt-5.1'

function translateMessages(messages: AnthropicMessage[]): OpenAIMessage[] {
  const translated: OpenAIMessage[] = []
  for (const message of messages) {
    if (typeof message.content === 'string') {
      translated.push({ role: message.role, content: message.content })
      continue
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const blocks = message.content as ContentBlock[]
      const text = blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')
      const toolCalls = blocks
        .filter((block) => block.type === 'tool_use')
        .map((block) => ({
          id: block.id as string,
          type: 'function' as const,
          function: {
            name: block.name as string,
            arguments: JSON.stringify(block.input),
          },
        }))
      translated.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    if (message.role === 'user' && Array.isArray(message.content)) {
      const results = (message.content as ContentBlock[]).filter((block) => block.type === 'tool_result')
      if (results.length > 0) {
        const imageMessages: OpenAIMessage[] = []
        for (const result of results) {
          let content = result.content
          if (Array.isArray(result.content)) {
            const blocks = result.content as ContentBlock[]
            content = blocks
              .filter((block) => block.type === 'text')
              .map((block) => ({ type: 'text', text: block.text ?? '' }))
            const images = blocks
              .filter((block) => block.type === 'image')
              .map((block) => ({
                type: 'image_url',
                image_url: {
                  url: `data:${block.source?.media_type};base64,${block.source?.data}`,
                },
              }))
            if (images.length > 0) {
              // Chat Completions tool messages accept text only. A following
              // user message keeps tool responses contiguous and carries vision.
              imageMessages.push({
                role: 'user',
                content: [
                  { type: 'text', text: `Images returned by tool call ${result.tool_use_id}:` },
                  ...images,
                ],
              })
            }
          }
          translated.push({
            role: 'tool',
            tool_call_id: result.tool_use_id,
            content,
          })
        }
        translated.push(...imageMessages)
        continue
      }
    }
    translated.push({ role: message.role, content: message.content })
  }
  return translated
}

/**
 * The staging director chat on OpenAI. This adapter keeps the tool loop
 * Anthropic-shaped so runAgentTurn and its tools stay provider-neutral.
 */
export function createOpenAIAgentClient(opts?: {
  model?: string
  apiKey?: string
  baseUrl?: string
  fetchFn?: typeof fetch
}): StagingAgentClient {
  const model = opts?.model ?? process.env.STAGING_AGENT_MODEL ?? DEFAULT_STAGING_AGENT_MODEL
  const baseUrl = opts?.baseUrl ?? 'https://api.openai.com/v1'
  const fetchFn = opts?.fetchFn ?? fetch

  return {
    messages: {
      async create(params: unknown) {
        const request = params as {
          system?: string
          max_tokens?: number
          tools?: AnthropicTool[]
          messages?: AnthropicMessage[]
        }
        const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY
        if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
        const messages: OpenAIMessage[] = [
          ...(request.system ? [{ role: 'system', content: request.system }] : []),
          ...translateMessages(request.messages ?? []),
        ]
        const tools = request.tools?.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        }))
        const res = await fetchFn(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            max_completion_tokens: request.max_tokens,
            messages,
            tools,
          }),
        })
        if (!res.ok) throw new Error(`staging agent api ${res.status}: ${(await res.text()).slice(0, 400)}`)
        const json = (await res.json()) as {
          choices: Array<{
            message: {
              content: string | null
              tool_calls?: Array<{
                id: string
                type: 'function'
                function: { name: string; arguments: string }
              }>
            }
          }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        const message = json.choices[0].message
        const usage = {
          input_tokens: json.usage?.prompt_tokens ?? 0,
          output_tokens: json.usage?.completion_tokens ?? 0,
        }
        if (message.tool_calls?.length) {
          const content: Array<
            { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }
          > = []
          if (message.content) content.push({ type: 'text', text: message.content })
          for (const toolCall of message.tool_calls) {
            let input: unknown
            try {
              input = JSON.parse(toolCall.function.arguments)
            } catch {
              throw new Error(`OpenAI tool "${toolCall.function.name}" returned arguments that are not valid JSON`)
            }
            content.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.function.name,
              input,
            })
          }
          return { stop_reason: 'tool_use', usage, content }
        }
        return {
          stop_reason: 'end_turn',
          usage,
          content: [{ type: 'text', text: message.content ?? '' }],
        }
      },
    },
  }
}

/**
 * The studio's staging director chat. Defaults to OpenAI so chat does not need
 * an Anthropic key. Set STAGING_AGENT_MODEL to "anthropic:<model>" to go back
 * to Claude.
 */
export function defaultAgentClient(): StagingAgentClient {
  const spec = process.env.STAGING_AGENT_MODEL ?? ''
  if (spec.startsWith('anthropic:')) {
    // Lazy so the Anthropic SDK is never constructed unless asked for.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createAnthropicAgentClient } = require('./agent') as typeof import('./agent')
    return createAnthropicAgentClient()
  }
  return createOpenAIAgentClient({
    model: spec.startsWith('openai:') ? spec.slice('openai:'.length) : undefined,
  })
}
