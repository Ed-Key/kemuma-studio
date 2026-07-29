import type { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPhoto, addPiece, createDesign, listEvents } from '@/lib/catalog/catalog'
import { getChatForDesign, getOrCreateChatForDesign } from '@/lib/catalog/chats'
import { openDb, type Db } from '@/lib/catalog/db'
import { AGENT_TOOLS } from '@/lib/staging/agent-tools'
import { type AgentStep, runAgentTurnViaClaudeSdk } from '@/lib/staging/agent-claude-sdk'

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

  describe('streaming a plan as it is written', () => {
    /** A plan_batch call arriving the way the API sends it: a start, a run of
     *  partial JSON, a stop, then the finished assistant message. */
    function streamingQuery(chunks: string[]): typeof query {
      return ((params: QueryParams) =>
        (async function* () {
          for await (const _ of params.prompt as AsyncIterable<unknown>) void _
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'tool_use', id: 'toolu_1', name: 'mcp__staging__plan_batch' },
            },
          }
          for (const partial_json of chunks) {
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json },
              },
            }
          }
          yield { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: 'toolu_1', name: 'mcp__staging__plan_batch', input: {} },
              ],
            },
          }
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Plan saved.',
            usage: { input_tokens: 10, output_tokens: 5 },
          }
        })()) as unknown as typeof query
    }

    it('reports each section as the director reaches it', async () => {
      const steps: unknown[] = []
      await runAgentTurnViaClaudeSdk(
        db,
        { designId, chatId, userText: 'stage it' },
        {
          queryFn: streamingQuery([
            '{"scene":"a warm walnut',
            ' side table","lighting":"evening lamp',
            ' off frame","product_lock":"do not',
            ' alter the carving"}',
          ]),
          onStep: (step) => steps.push(step),
        }
      )

      expect(steps).toEqual([
        { kind: 'tool', name: 'plan_batch', input: {} },
        { kind: 'writing', section: 'scene' },
        { kind: 'writing', section: 'lighting' },
        { kind: 'writing', section: 'product_lock' },
        { kind: 'done', turns: undefined },
      ])
    })

    it('announces the call once, from the stream rather than twice', async () => {
      // The finished assistant message carries the same tool_use id, and
      // reporting it again would say "writing the plan" after the plan was
      // already written.
      const steps: Array<{ kind: string }> = []
      await runAgentTurnViaClaudeSdk(
        db,
        { designId, chatId, userText: 'stage it' },
        {
          queryFn: streamingQuery(['{"scene":"x"}']),
          onStep: (step) => steps.push(step),
        }
      )
      expect(steps.filter((step) => step.kind === 'tool')).toHaveLength(1)
    })

    it('is not fooled by a section name written inside a value', async () => {
      // Taken from a real turn: the director named product_lock inside one of
      // its exclusions, and a plain text search read that as arriving back at
      // the product lock, so the rail showed it walking backwards through its
      // own plan.
      const steps: AgentStep[] = []
      await runAgentTurnViaClaudeSdk(
        db,
        { designId, chatId, userText: 'stage it' },
        {
          queryFn: streamingQuery([
            '{"product_lock":"do not alter the carving"',
            ',"extra_exclusions":["nothing that fights the ',
            '\\"product_lock\\" above"]',
            ',"n":4}',
          ]),
          onStep: (step) => steps.push(step),
        }
      )
      const sections = steps.flatMap((s) => (s.kind === 'writing' ? [s.section] : []))
      expect(sections).toEqual(['product_lock', 'extra_exclusions', 'n'])
    })

    it('waits for a key to finish arriving before naming it', async () => {
      // Field names stream in pieces like everything else, and half of one is
      // not a field name.
      const steps: AgentStep[] = []
      await runAgentTurnViaClaudeSdk(
        db,
        { designId, chatId, userText: 'stage it' },
        {
          queryFn: streamingQuery(['{"prod', 'uct_lock":"do not alter', ' the carving"}']),
          onStep: (step) => steps.push(step),
        }
      )
      expect(steps.flatMap((s) => (s.kind === 'writing' ? [s.section] : []))).toEqual(['product_lock'])
    })
  })
})
