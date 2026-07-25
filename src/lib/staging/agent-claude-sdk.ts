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
  | { kind: 'writing'; section: string }
  | { kind: 'done'; turns: number }

const PLAN_SECTIONS = new Set([
  'scene',
  'lighting',
  'subject_and_count',
  'composition',
  'product_lock',
  'extra_exclusions',
  'size',
  'n',
  'reference_photo_ids',
])

/**
 * Which field a half-written tool call is currently on.
 *
 * Searching the text for the field names looks sufficient and is not. A real
 * turn wrote the phrase "product_lock" inside one of its exclusions, and the
 * line jumped back from the exclusions to the product lock, so the rail
 * reported the director going backwards through its own plan.
 *
 * So this walks the JSON instead, counting a name only where a name can be:
 * at the top level of the object, outside any string. An unterminated string
 * at the end is the value being typed right now, which is exactly why the key
 * before it is the answer.
 */
function sectionInProgress(partialJson: string): string | null {
  let latest: string | null = null
  let depth = 0
  let i = 0

  while (i < partialJson.length) {
    const char = partialJson[i]
    if (char === '{' || char === '[') {
      depth++
      i++
      continue
    }
    if (char === '}' || char === ']') {
      depth--
      i++
      continue
    }
    if (char !== '"') {
      i++
      continue
    }

    let end = i + 1
    let text = ''
    while (end < partialJson.length && partialJson[end] !== '"') {
      if (partialJson[end] === '\\') {
        text += partialJson[end + 1] ?? ''
        end += 2
        continue
      }
      text += partialJson[end]
      end++
    }
    // Ran off the end: this string is still being written, and everything
    // after it has not arrived yet.
    if (end >= partialJson.length) break

    let after = end + 1
    while (after < partialJson.length && /\s/.test(partialJson[after])) after++
    if (depth === 1 && partialJson[after] === ':' && PLAN_SECTIONS.has(text)) {
      latest = text
    }
    i = end + 1
  }

  return latest
}

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
  /* The plan_batch call currently being composed, if one is. `index` pins the
     deltas to it: other content blocks stream in the same event sequence. */
  let plan: { index: number; json: string; section: string | null } | null = null
  const streamedPlanCalls = new Set<string>()

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
      // Without this the longest silence in a turn is a single plan_batch call,
      // where the director spends most of a minute composing six sections and
      // the run has nothing to say until the whole thing arrives.
      includePartialMessages: true,
    },
  })) {
    // The stream is the only account of what the director is doing between the
    // click and the reply. Everything except the result used to be dropped on
    // the floor, which is why a turn that looks at nine photos and rewrites a
    // rejected plan showed the owner one spinner and no idea whether it was
    // stuck. Report each frame; callers that do not care pass nothing.
    if (message.type === 'stream_event') {
      const event = message.event
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        const name = String(event.content_block.name).replace('mcp__staging__', '')
        if (name === 'plan_batch') {
          // Announced here rather than from the finished message, so "writing
          // the plan" lands before the sections it is made of rather than
          // after them. Every other tool waits for its complete input, which
          // is the only place the arguments worth naming actually arrive.
          streamedPlanCalls.add(event.content_block.id)
          plan = { index: event.index, json: '', section: null }
          step({ kind: 'tool', name, input: {} })
        }
      } else if (
        plan
        && event.type === 'content_block_delta'
        && event.index === plan.index
        && event.delta.type === 'input_json_delta'
      ) {
        plan.json += event.delta.partial_json
        const section = sectionInProgress(plan.json)
        // Only on a boundary. A row per delta would be a row per few tokens,
        // and the line would be rewritten faster than it could be read.
        if (section && section !== plan.section) {
          plan.section = section
          step({ kind: 'writing', section })
        }
      } else if (plan && event.type === 'content_block_stop' && event.index === plan.index) {
        plan = null
      }
    } else if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'tool_use') {
          // Skipped only if the stream already announced it, so turning
          // streaming off leaves every tool reported exactly once.
          if (streamedPlanCalls.has(block.id)) continue
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
