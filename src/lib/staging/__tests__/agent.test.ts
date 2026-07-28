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

  /* The plan stopped carrying a SUBJECT AND COUNT sentence and started carrying
     structured counts, and counts.what now refuses the word "exactly" outright.
     The system prompt still asked for the sentence and still named "exactly" as
     the rule to satisfy, so the director was being told to write the one string
     the schema rejects. The first live run did exactly that. */
  describe('the contract the system prompt teaches', () => {
    const prompt = () => buildAgentSystemPrompt()

    it('no longer asks for a SUBJECT AND COUNT sentence', () => {
      expect(prompt()).not.toMatch(/SUBJECT AND COUNT/)
    })

    it('no longer tells the director to write the word "exactly"', () => {
      expect(prompt()).not.toMatch(/with the word "exactly"/)
    })

    it('names the fields the plan actually has', () => {
      expect(prompt()).toMatch(/\bcounts\b/)
      expect(prompt()).toMatch(/\barrangement\b/)
    })

    it('says the count sentence is written for the director', () => {
      expect(prompt()).toMatch(/count sentence is (written|assembled)/i)
    })

    it('no longer promises six sections', () => {
      expect(prompt()).not.toMatch(/all six prompt sections/)
    })
  })

  /* The rejection cap counts on a context object. This path rebuilt that object
     inside the tool loop, so the count reset to zero on every call and the cap
     could never trip: the loop the cap exists to stop was still reachable here
     the whole time. */
  it('carries one tool context across the whole turn, so the rejection cap can trip', async () => {
    const badPlan = {
      scene: 'On a dresser.',
      lighting: 'Warm window light from the left with contact shadows.',
      counts: [],
      arrangement: 'The dish on its own.',
      composition: 'Centred at 8 inches.',
      product_lock: 'Banded rim.',
      extra_exclusions: [],
      size: '1536x1024',
      reference_photo_ids: [1],
      n: 4,
    }
    const results: string[] = []
    const stubborn: StagingAgentClient = {
      messages: {
        async create(params: unknown) {
          // Collect what the tool said back on the previous round trip.
          const messages = (params as { messages: Array<{ role: string; content: unknown }> }).messages
          for (const message of messages) {
            if (!Array.isArray(message.content)) continue
            for (const block of message.content as Array<{ type: string; content?: unknown }>) {
              if (block.type !== 'tool_result') continue
              const first = (block.content as Array<{ text?: string }>)[0]
              if (first?.text && !results.includes(first.text)) results.push(first.text)
            }
          }
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 10, output_tokens: 5 },
            content: [{ type: 'tool_use', id: 'tu_p', name: 'plan_batch', input: badPlan }],
          }
        },
      },
    } as StagingAgentClient

    await expect(runAgentTurn(db, stubborn, { designId, chatId, userText: 'stage it' })).rejects.toThrow(
      /tool-loop limit/
    )
    expect(results.some((text) => /stop calling plan_batch/i.test(text))).toBe(true)
  })
})
