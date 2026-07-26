import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto, listEvents } from '@/lib/catalog/catalog'
import { getOrCreateChatForDesign, getChatForDesign } from '@/lib/catalog/chats'
import { buildAgentSystemPrompt, runAgentTurn, type StagingAgentClient } from '@/lib/staging/agent'

function tempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-agent-')), 'catalog.sqlite')
}

// Scripted client: first call requests the view_design tool, second returns text.
function scriptedClient(log: unknown[]): StagingAgentClient {
  let call = 0
  return {
    messages: {
      async create(params: unknown) {
        log.push(params)
        call += 1
        if (call === 1) {
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 1000, output_tokens: 50 },
            content: [{ type: 'tool_use', id: 'tu_1', name: 'view_design', input: {} }],
          }
        }
        return {
          stop_reason: 'end_turn',
          usage: { input_tokens: 1200, output_tokens: 80 },
          content: [{ type: 'text', text: 'Planned: gold chain over the rim on a dresser.' }],
        }
      },
    },
  } as StagingAgentClient
}

describe('staging agent loop', () => {
  let db: Db
  let designId: number
  let chatId: number

  beforeEach(() => {
    db = openDb(tempDbPath())
    designId = createDesign(db, { family: 'trinket dish', name: 'Canoe Trinket Dish' })
    const pieceId = addPiece(db, {
      design_id: designId, colorway: 'maroon', height_in: 2, width_in: 8, depth_in: 3, weight_lb: 1.5,
    })
    addPhoto(db, { piece_id: pieceId, file_path: '/tmp/x.jpg', position: 0 })
    chatId = getOrCreateChatForDesign(db, designId).chat_id
  })

  it('runs tools, persists the conversation, and logs usage', async () => {
    const log: unknown[] = []
    const out = await runAgentTurn(db, scriptedClient(log), {
      designId, chatId, userText: 'it holds my jewelry, stage it like that',
    })
    expect(out.reply).toMatch(/gold chain/)
    expect(out.input_tokens).toBe(2200)
    const msgs = JSON.parse(getChatForDesign(db, designId)!.messages_json)
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user' })
    expect(msgs[1]).toMatchObject({ role: 'assistant', text: expect.stringContaining('gold chain') })
    expect(listEvents(db).some((e) => e.type === 'chat.turn')).toBe(true)
    // Second call must carry the tool result back.
    const second = log[1] as { messages: Array<{ role: string; content: unknown }> }
    const last = second.messages[second.messages.length - 1]
    expect(last.role).toBe('user')
    expect(JSON.stringify(last.content)).toMatch(/tool_result/)
  })

  it('replays prior visible messages on later turns', async () => {
    const log: unknown[] = []
    await runAgentTurn(db, scriptedClient(log), { designId, chatId, userText: 'first message' })
    const log2: unknown[] = []
    await runAgentTurn(db, scriptedClient(log2), { designId, chatId, userText: 'second message' })
    const first = log2[0] as { messages: Array<{ role: string }> }
    // prior user + prior assistant + new user
    expect(first.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('system prompt carries the rails', () => {
    const system = buildAgentSystemPrompt()
    // The lock sentences are deliberately absent now: asking the agent to
    // reproduce them is what the assembler took over.
    expect(system).not.toMatch(/never composited/)
    expect(system).toMatch(/exactly/)
    expect(system).toMatch(/plan_batch/)
    expect(system).toMatch(/does not generate|never generate/i)
    expect(system).toMatch(/save_staging_note/)
  })

  it('gives up cleanly when the loop cap is hit', async () => {
    const endless: StagingAgentClient = {
      messages: {
        async create() {
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 10, output_tokens: 5 },
            content: [{ type: 'tool_use', id: 'tu_x', name: 'view_design', input: {} }],
          }
        },
      },
    } as StagingAgentClient
    await expect(runAgentTurn(db, endless, { designId, chatId, userText: 'hi' })).rejects.toThrow(/tool-loop limit/)
  })
})
