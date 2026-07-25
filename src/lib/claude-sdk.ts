import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ApiImageBlock } from '@/lib/writer/generate'

export type ClaudeSdkQueryFn = typeof query

export function claudeSubscriptionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

async function* visionPrompt(images: ApiImageBlock[], text: string) {
  yield {
    type: 'user' as const,
    session_id: '',
    parent_tool_use_id: null,
    message: {
      role: 'user' as const,
      content: [...images, { type: 'text' as const, text }],
    },
  }
}

export async function queryClaudeStructured<T>(input: {
  queryFn?: ClaudeSdkQueryFn
  model?: string
  systemPrompt: string
  userText: string
  images: ApiImageBlock[]
  schema: z.ZodType<T>
}): Promise<{ parsed: T; input_tokens: number; output_tokens: number }> {
  const queryFn = input.queryFn ?? query
  let result: SDKResultMessage | undefined
  for await (const message of queryFn({
    prompt: visionPrompt(input.images, input.userText),
    options: {
      ...(input.model ? { model: input.model } : {}),
      systemPrompt: input.systemPrompt,
      env: claudeSubscriptionEnv(),
      settingSources: [],
      strictMcpConfig: true,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      allowedTools: [],
      tools: [],
      outputFormat: {
        type: 'json_schema',
        schema: z.toJSONSchema(input.schema, { target: 'draft-7' }),
      },
    },
  })) {
    if (message.type === 'result') result = message
  }

  if (!result) throw new Error('Claude Agent SDK returned no result message')
  if (result.subtype === 'error_max_structured_output_retries') {
    throw new Error(`Claude Agent SDK exhausted structured output retries: ${result.errors.join('; ')}`)
  }
  if (result.subtype !== 'success') {
    throw new Error(`Claude Agent SDK failed with ${result.subtype}: ${result.errors.join('; ')}`)
  }
  if (result.structured_output == null) {
    throw new Error('Claude Agent SDK returned success with no structured_output')
  }
  return {
    parsed: input.schema.parse(result.structured_output),
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
  }
}
