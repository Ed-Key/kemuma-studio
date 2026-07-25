import {
  query,
  createSdkMcpServer,
  tool,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Db } from '@/lib/catalog/db'
import { getDesignDetail, logEvent } from '@/lib/catalog/catalog'
import { appendChatMessages, getChatForDesign, type ChatMessage } from '@/lib/catalog/chats'
import { claudeSubscriptionEnv, type ClaudeSdkQueryFn } from '@/lib/claude-sdk'
import { computeCostUsd } from '@/lib/writer/prices'
import { AGENT_TOOLS, executeAgentTool } from './agent-tools'
import { buildAgentSystemPrompt } from './agent'

type JsonProperty = {
  type: 'string' | 'number' | 'array'
  enum?: readonly string[]
  items?: JsonProperty
}

type JsonObjectSchema = {
  properties: Record<string, JsonProperty>
  required?: readonly string[]
}

function zodField(schema: JsonProperty): z.ZodType {
  if (schema.enum && schema.enum.length > 0) {
    return z.enum(schema.enum as [string, ...string[]])
  }
  if (schema.type === 'string') return z.string()
  if (schema.type === 'number') return z.number()
  if (schema.type === 'array' && schema.items) return z.array(zodField(schema.items))
  throw new Error(`unsupported staging tool schema type "${schema.type}"`)
}

function zodShape(schema: JsonObjectSchema): z.ZodRawShape {
  const required = new Set(schema.required ?? [])
  return Object.fromEntries(
    Object.entries(schema.properties).map(([name, field]) => {
      const parsed = zodField(field)
      return [name, required.has(name) ? parsed : parsed.optional()]
    })
  )
}

function priorConversation(messages: ChatMessage[], userText: string): string {
  const history = messages
    .map((message) => `${message.role === 'user' ? 'OWNER' : 'STAGING DIRECTOR'}: ${message.text}`)
    .join('\n')
  return [
    ...(history ? ['Prior visible conversation:', history, ''] : []),
    'Current owner message:',
    userText,
  ].join('\n')
}

async function* agentPrompt(messages: ChatMessage[], userText: string) {
  yield {
    type: 'user' as const,
    session_id: '',
    parent_tool_use_id: null,
    message: {
      role: 'user' as const,
      content: priorConversation(messages, userText),
    },
  }
}

function stagingMcpServer(db: Db, input: { designId: number; chatId: number }) {
  return createSdkMcpServer({
    name: 'kemuma-staging',
    version: '1.0.0',
    tools: AGENT_TOOLS.map((agentTool) =>
      tool(
        agentTool.name,
        agentTool.description,
        zodShape(agentTool.input_schema as unknown as JsonObjectSchema),
        async (args) => {
          const result = await executeAgentTool(
            db,
            { designId: input.designId, chatId: input.chatId },
            agentTool.name,
            args
          )
          return {
            content: result.map((block) =>
              block.type === 'text'
                ? block
                : {
                    type: 'image' as const,
                    data: block.source.data,
                    mimeType: block.source.media_type,
                  }
            ),
          }
        }
      )
    ),
  })
}

/**
 * The staging director chat on the Claude Agent SDK. The SDK owns the tool
 * loop, while the app keeps ownership of catalog tools and visible chat state.
 */
/** What the staging director is doing right now, frame by frame. */
export type AgentStep =
  | { kind: 'tool'; name: string; input: unknown }
  | { kind: 'say'; text: string }
  | { kind: 'done'; turns: number }

export async function runAgentTurnViaClaudeSdk(
  db: Db,
  input: { designId: number; chatId: number; userText: string },
  opts?: { model?: string; queryFn?: ClaudeSdkQueryFn; onStep?: (step: AgentStep) => void }
): Promise<{ reply: string; input_tokens: number; output_tokens: number }> {
  const detail = getDesignDetail(db, input.designId)
  if (!detail) throw new Error(`design ${input.designId} not found`)
  const chat = getChatForDesign(db, input.designId)
  if (!chat) throw new Error(`no chat for design ${input.designId}`)

  const prior = JSON.parse(chat.messages_json) as ChatMessage[]
  const spec = process.env.STAGING_AGENT_MODEL ?? ''
  const model =
    opts?.model ?? (spec.startsWith('claude-sub:') ? spec.slice('claude-sub:'.length) : undefined)
  const queryFn = opts?.queryFn ?? query
  const allowedTools = AGENT_TOOLS.map((agentTool) => `mcp__staging__${agentTool.name}`)
  let result: SDKResultMessage | undefined

  const step = opts?.onStep ?? (() => {})

  for await (const message of queryFn({
    prompt: agentPrompt(prior, input.userText),
    options: {
      ...(model ? { model } : {}),
      systemPrompt: buildAgentSystemPrompt(),
      env: claudeSubscriptionEnv(),
      settingSources: [],
      strictMcpConfig: true,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      tools: [],
      allowedTools,
      mcpServers: { staging: stagingMcpServer(db, input) },
      // Not the same 8 as runAgentTurn's MAX_TURNS, which this was copied from.
      // There one iteration meant one model reply that could fire several tools
      // at once; here a turn is a single round trip. The mandated process is
      // view_design, view_photos (four ids at a time), review_history,
      // save_staging_note, plan_batch, plus the reply, and the system prompt
      // tells the director to call plan_batch again after validation errors.
      // That clears 8 on any real piece, which is how a working director came
      // back to the owner as "could not respond".
      maxTurns: 24,
    },
  })) {
    // The stream is the only account of what the director is doing between the
    // click and the reply. Everything except the result used to be dropped on
    // the floor, which is why a turn that looks at nine photos and rewrites a
    // rejected plan showed the owner one spinner and no idea whether it was
    // stuck. Report each frame; callers that do not care pass nothing.
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'tool_use') {
          step({ kind: 'tool', name: String(block.name).replace('mcp__staging__', ''), input: block.input })
        } else if (block.type === 'text' && block.text.trim()) {
          step({ kind: 'say', text: block.text.trim() })
        }
      }
    } else if (message.type === 'result') {
      result = message
      step({ kind: 'done', turns: message.num_turns })
    }
  }

  if (!result) throw new Error('Claude Agent SDK returned no result message')
  if (result.subtype !== 'success') {
    throw new Error(`Claude Agent SDK staging agent failed with ${result.subtype}: ${result.errors.join('; ')}`)
  }

  const reply = result.result
  const inputTokens = result.usage.input_tokens
  const outputTokens = result.usage.output_tokens
  appendChatMessages(db, input.chatId, [
    { role: 'user', text: input.userText },
    { role: 'assistant', text: reply },
  ])
  logEvent(db, 'chat.turn', {
    design_id: input.designId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: computeCostUsd(`claude-sub:${model || 'default'}`, inputTokens, outputTokens),
  })
  return { reply, input_tokens: inputTokens, output_tokens: outputTokens }
}
