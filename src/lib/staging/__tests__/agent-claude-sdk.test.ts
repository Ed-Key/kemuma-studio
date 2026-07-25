import type { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPhoto, addPiece, createDesign, listEvents } from '@/lib/catalog/catalog'
import { getChatForDesign, getOrCreateChatForDesign } from '@/lib/catalog/chats'
import { openDb, type Db } from '@/lib/catalog/db'
import { AGENT_TOOLS } from '@/lib/staging/agent-tools'
import { runAgentTurnViaClaudeSdk } from '@/lib/staging/agent-claude-sdk'

type QueryParams = Parameters<typeof query>[0]

function tempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-agent-sdk-')), 'catalog.sqlite')
}

function fakeQuery(
  capture: { params?: QueryParams; promptMessages?: unknown[] },
  reply = 'I set up a warm dresser scene with the chain over the rim.'
): typeof query {
  return ((params: QueryParams) => {
    capture.params = params
    return (async function* () {
      capture.promptMessages = []
      for await (const message of params.prompt as AsyncIterable<unknown>) {
        capture.promptMessages.push(message)
      }
      yield {
        type: 'result',
        subtype: 'success',
        result: reply,
        usage: { input_tokens: 2100, output_tokens: 140 },
      }
    })()
  }) as unknown as typeof query
}

describe('runAgentTurnViaClaudeSdk', () => {
  let db: Db
  let designId: number
  let chatId: number

  beforeEach(() => {
    db = openDb(tempDbPath())
    designId = createDesign(db, { family: 'trinket dish', name: 'Canoe Trinket Dish' })
    const pieceId = addPiece(db, {
      design_id: designId,
      colorway: 'maroon',
      height_in: 2,
      width_in: 8,
      depth_in: 3,
      weight_lb: 1.5,
    })
    addPhoto(db, { piece_id: pieceId, file_path: '/tmp/x.jpg', position: 0 })
    chatId = getOrCreateChatForDesign(db, designId).chat_id
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('runs the isolated SDK loop, persists the reply, and logs usage', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-leak')
    const capture: { params?: QueryParams; promptMessages?: unknown[] } = {}

    const out = await runAgentTurnViaClaudeSdk(
      db,
      { designId, chatId, userText: 'it holds my jewelry, stage it like that' },
      { queryFn: fakeQuery(capture), model: 'claude-test' }
    )

    expect(out).toEqual({
      reply: 'I set up a warm dresser scene with the chain over the rim.',
      input_tokens: 2100,
      output_tokens: 140,
    })
    const messages = JSON.parse(getChatForDesign(db, designId)!.messages_json)
    expect(messages).toEqual([
      { role: 'user', text: 'it holds my jewelry, stage it like that' },
      { role: 'assistant', text: out.reply },
    ])
    expect(listEvents(db).some((event) => event.type === 'chat.turn')).toBe(true)

    const options = capture.params!.options!
    expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(options).toMatchObject({
      model: 'claude-test',
      settingSources: [],
      strictMcpConfig: true,
      permissionMode: 'bypassPermissions',
      tools: [],
    })
    expect(options.allowedTools).toEqual(
      AGENT_TOOLS.map((agentTool) => `mcp__staging__${agentTool.name}`)
    )
    expect(options.mcpServers).toHaveProperty('staging')
  })

  it('replays prior visible messages in the next SDK prompt', async () => {
    await runAgentTurnViaClaudeSdk(
      db,
      { designId, chatId, userText: 'first request' },
      { queryFn: fakeQuery({}) }
    )
    const capture: { params?: QueryParams; promptMessages?: unknown[] } = {}

    await runAgentTurnViaClaudeSdk(
      db,
      { designId, chatId, userText: 'second request' },
      { queryFn: fakeQuery(capture, 'Second reply.') }
    )

    expect(JSON.stringify(capture.promptMessages)).toContain('first request')
    expect(JSON.stringify(capture.promptMessages)).toContain('warm dresser scene')
    expect(JSON.stringify(capture.promptMessages)).toContain('second request')
  })
})
