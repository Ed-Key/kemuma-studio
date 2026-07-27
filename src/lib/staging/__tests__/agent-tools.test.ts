import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto } from '@/lib/catalog/catalog'
import { getOrCreateChatForDesign, getChatForDesign, stagingNotesForDesign } from '@/lib/catalog/chats'
import { createStagedImage } from '@/lib/catalog/staged'
import { AGENT_TOOLS, executeAgentTool } from '@/lib/staging/agent-tools'

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'kemuma-tools-'))
}

describe('agent tools', () => {
  let db: Db
  let designId: number
  let chatId: number
  let photoId: number

  beforeEach(async () => {
    const dir = tempDir()
    db = openDb(path.join(dir, 'catalog.sqlite'))
    designId = createDesign(db, { family: 'trinket dish', name: 'Canoe Trinket Dish' })
    const pieceId = addPiece(db, {
      design_id: designId, colorway: 'maroon', height_in: 2, width_in: 8, depth_in: 3, weight_lb: 1.5,
    })
    const photoPath = path.join(dir, 'p.jpg')
    await sharp({ create: { width: 40, height: 30, channels: 3, background: '#996655' } }).jpeg().toFile(photoPath)
    photoId = addPhoto(db, { piece_id: pieceId, file_path: photoPath, position: 0 })
    chatId = getOrCreateChatForDesign(db, designId).chat_id
  })

  const ctx = () => ({ designId, chatId })

  it('declares every tool the loop dispatches', () => {
    const names = AGENT_TOOLS.map((t) => t.name)
    expect(names).toEqual(['view_design', 'view_photos', 'list_scenes', 'review_history', 'save_staging_note', 'plan_batch'])
  })

  it('view_design returns the catalog record as text', async () => {
    const out = await executeAgentTool(db, ctx(), 'view_design', {})
    expect(out[0].type).toBe('text')
    expect((out[0] as { text: string }).text).toMatch(/Canoe Trinket Dish/)
    expect((out[0] as { text: string }).text).toMatch(/8/)
  })

  it('view_photos returns captions and image blocks, capped at four', async () => {
    const out = await executeAgentTool(db, ctx(), 'view_photos', { photo_ids: [photoId] })
    expect(out.some((b) => b.type === 'image')).toBe(true)
    const big = await executeAgentTool(db, ctx(), 'view_photos', { photo_ids: [photoId, photoId, photoId, photoId, photoId] })
    expect(big.filter((b) => b.type === 'image')).toHaveLength(4)
  })

  it('list_scenes returns the family scene library', async () => {
    const out = await executeAgentTool(db, ctx(), 'list_scenes', {})
    expect((out[0] as { text: string }).text).toMatch(/coffee-table|entry-console|nightstand/)
  })

  it('review_history reports prior batches and verdicts', async () => {
    createStagedImage(db, {
      design_id: designId, scene_key: 'entry-console', source_photo_id: photoId,
      prompt: 'SCENE - x', file_path: '/tmp/s.png', model: 'gpt-image-2-2026-04-21', cost_usd: 0.19,
    })
    const out = await executeAgentTool(db, ctx(), 'review_history', {})
    expect((out[0] as { text: string }).text).toMatch(/entry-console/)
    expect((out[0] as { text: string }).text).toMatch(/candidate/)
  })

  it('save_staging_note persists the note', async () => {
    await executeAgentTool(db, ctx(), 'save_staging_note', { note: 'jewelry catch-all' })
    expect(stagingNotesForDesign(db, designId)).toBe('jewelry catch-all')
  })

  it('plan_batch validates and stores the pending plan', async () => {
    const good = {
      scene: 'Photorealistic editorial product photograph on a dresser with a gold chain draped over the rim.',
      lighting:
        "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination with directionally consistent contact shadows.",
      subject_and_count: 'Image 1 is the only product reference. Show exactly one dish, appearing exactly once.',
      composition: 'Slightly left of center at realistic 8-inch length.',
      product_lock: 'Use the exact physical product from Image 1. Do not restyle, redraw, smooth, or symmetrize.',
      extra_exclusions: [],
      size: '1536x1024',
      reference_photo_ids: [photoId],
      n: 4,
    }
    // Omitting a count is the only way left to fail: the lock sentences are
    // supplied by the assembler rather than demanded from the agent.
    const bad = await executeAgentTool(db, ctx(), 'plan_batch', {
      ...good,
      subject_and_count: 'The dish on its own.',
    })
    expect((bad[0] as { text: string }).text).toMatch(/exactly/)
    expect(getChatForDesign(db, designId)!.pending_plan_json).toBeNull()

    const thin = await executeAgentTool(db, ctx(), 'plan_batch', { ...good, lighting: 'soft light' })
    expect((thin[0] as { text: string }).text).toMatch(/plan saved/i)

    const ok = await executeAgentTool(db, ctx(), 'plan_batch', good)
    expect((ok[0] as { text: string }).text).toMatch(/plan saved/i)
    const stored = JSON.parse(getChatForDesign(db, designId)!.pending_plan_json!)
    expect(stored.reference_photo_ids).toEqual([photoId])
  })


  /* Reproduction of the loop seen in production: eight director runs rejected
     their own plan over and over, worst case thirteen times, because nothing
     ever told the agent to stop asking. The plan below fails the one rule a
     writer can still fail, a subject line with no count in it. */
  const badPlan = () => ({
    scene: 'Photorealistic editorial product photograph on a dresser.',
    lighting: 'Soft window light from the left with directionally consistent contact shadows.',
    subject_and_count: 'The dish on its own.',
    composition: 'Slightly left of center at realistic 8-inch length.',
    product_lock: 'Banded rim, chipped edge, dark veining.',
    extra_exclusions: [],
    size: '1536x1024',
    reference_photo_ids: [photoId],
    n: 4,
  })

  it('stops inviting a retry once the plan has been rejected three times', async () => {
    const runCtx = ctx()
    const said = []
    for (let attempt = 1; attempt <= 5; attempt++) {
      const out = await executeAgentTool(db, runCtx, 'plan_batch', badPlan())
      said.push((out[0] as { text: string }).text)
    }

    // The first three are worth another try; after that the run is stuck and
    // saying "call it again" is what produced the thirteen-call loop.
    expect(said[0]).toMatch(/call plan_batch again/i)
    expect(said[2]).toMatch(/call plan_batch again/i)
    expect(said[3]).not.toMatch(/call plan_batch again/i)
    expect(said[3]).toMatch(/stop calling plan_batch/i)
    expect(said[3]).toMatch(/tell the owner/i)
    expect(said[4]).not.toMatch(/call plan_batch again/i)

    // Whatever it says, it must never quietly accept a plan that failed.
    expect(getChatForDesign(db, designId)!.pending_plan_json).toBeNull()
  })

  it('names the rule that failed rather than only that something failed', async () => {
    const out = await executeAgentTool(db, ctx(), 'plan_batch', badPlan())
    const text = (out[0] as { text: string }).text
    expect(text).toMatch(/exactly/)
    expect(text).toMatch(/SUBJECT AND COUNT/i)
  })

  it('unknown tools report an error result', async () => {
    const out = await executeAgentTool(db, ctx(), 'nope', {})
    expect((out[0] as { text: string }).text).toMatch(/unknown tool/)
  })
})
