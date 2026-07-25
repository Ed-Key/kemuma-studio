import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto, getDesignDetail } from '@/lib/catalog/catalog'
import { getOrCreateChatForDesign, setStagingNotes } from '@/lib/catalog/chats'
import { listStagedForDesign } from '@/lib/catalog/staged'
import { runStaging, runPlannedBatch } from '@/lib/staging/stage'
import type { ArtDirector } from '@/lib/staging/direct'
import type { ArtDirection } from '@/lib/staging/prompt'
import type { StagingPlan } from '@/lib/staging/plan'
import type { ImageGenerator } from '@/lib/staging/images-api'

const goodDirection: ArtDirection = {
  subject_and_count:
    'Image 1 is the only product reference. Show exactly one coaster set of exactly four coasters, appearing exactly once.',
  composition: 'Loose fan slightly left of center at realistic 3.8-inch scale, three-quarter view.',
  product_lock:
    'Use the exact physical product from Image 1. Preserve its silhouette and painted artwork. Do not restyle, redraw, smooth, or symmetrize.',
  extra_exclusions: [],
}

const variedDirection = {
  subject_and_count:
    'Images 1 to 2 are different views of the same product. Show exactly one set of exactly four coasters, appearing exactly once.',
  product_lock:
    'Use the exact physical product from Image 1. Preserve its silhouette and painted artwork. Do not restyle, redraw, smooth, or symmetrize.',
  extra_exclusions: [],
  compositions: [
    'Loose fan slightly left of center at realistic 3.8-inch scale.',
    'Neat low stack with small offsets, three-quarter view at 3.8-inch scale.',
    'Row of four with the painted faces angled to camera, 3.8-inch scale.',
    'Two propped against two flat, closer crop, 3.8-inch scale.',
  ] as [string, string, string, string],
}

function fakeDirector(directions: ArtDirection[]): ArtDirector & { calls: number; variedCalls: number; lastImageCount: number } {
  const d = {
    label: 'claude-opus-4-8',
    calls: 0,
    variedCalls: 0,
    lastImageCount: 0,
    async direct() {
      const direction = directions[Math.min(d.calls, directions.length - 1)]
      d.calls += 1
      return { direction, input_tokens: 1000, output_tokens: 200 }
    },
    async directVaried(_userText: string, images: unknown[]) {
      d.variedCalls += 1
      d.lastImageCount = images.length
      return { direction: variedDirection, input_tokens: 2000, output_tokens: 400 }
    },
  }
  return d
}

async function fakeImagesFetch(counter?: { calls: number; ns: number[] }): Promise<typeof fetch> {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 10, b: 10 } } })
    .png()
    .toBuffer()
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const n = Number((init?.body as FormData).get('n'))
    if (counter) {
      counter.calls += 1
      counter.ns.push(n)
    }
    return new Response(
      JSON.stringify({
        data: Array.from({ length: n }, () => ({ b64_json: png.toString('base64') })),
        usage: {
          input_tokens: 1791, output_tokens: 5488,
          input_tokens_details: { image_tokens: 1536, text_tokens: 255 },
          output_tokens_details: { image_tokens: 5488, text_tokens: 0 },
        },
      }),
      { status: 200 }
    )
  }) as typeof fetch
}

async function fakeImageGenerator(label = 'codex:image_generation'): Promise<ImageGenerator> {
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 10, b: 10 } },
  })
    .png()
    .toBuffer()
  return {
    label,
    async generate(input) {
      return {
        images: Array.from({ length: input.n }, () => png),
        usage: { input_tokens: 0, output_tokens: 0 },
        cost_usd: 0,
      }
    },
  }
}

describe('runStaging', () => {
  let db: Db
  let dataDir: string
  let designId: number

  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'kemuma-stage-'))
    db = openDb(path.join(dataDir, 'catalog.sqlite'))
    designId = createDesign(db, { family: 'coaster set', name: 'Safari Sunset Coasters' })
    const pieceId = addPiece(db, {
      design_id: designId, colorway: 'sunset', height_in: 0.3, width_in: 3.8, depth_in: 3.8, weight_lb: 6.5,
    })
    const photoPath = path.join(dataDir, 'photo.jpg')
    await sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 150, g: 110, b: 70 } } })
      .jpeg()
      .toFile(photoPath)
    addPhoto(db, { piece_id: pieceId, file_path: photoPath, position: 0 })
    const photoPath2 = path.join(dataDir, 'photo2.jpg')
    await sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 90, g: 70, b: 50 } } })
      .jpeg()
      .toFile(photoPath2)
    addPhoto(db, { piece_id: pieceId, file_path: photoPath2, position: 1 })
  })

  it('stages a batch of four candidates with files, prompts, and shared cost', async () => {
    const director = fakeDirector([goodDirection])
    const ids = await runStaging(
      db,
      { artDirector: director, fetchFn: await fakeImagesFetch(), apiKey: 'sk-test' },
      { designId, dataDir, sceneKey: 'coffee-table' }
    )
    expect(ids).toHaveLength(4)
    const rows = listStagedForDesign(db, designId)
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row.scene_key).toBe('coffee-table')
      expect(row.prompt).toContain('SCENE - ')
      expect(row.prompt).toContain('never composited')
      expect(existsSync(row.file_path)).toBe(true)
      // batch image cost (~0.1782) plus director cost (1000 in, 200 out on opus
      // = 0.010), split across four images
      expect(row.cost_usd).toBeCloseTo((0.178203 + 0.01) / 4, 4)
    }
    expect(director.calls).toBe(1)
  })

  it('retries the art director once when the assembled prompt fails validation', async () => {
    const bad: ArtDirection = { ...goodDirection, product_lock: 'Keep it the same.' }
    const director = fakeDirector([bad, goodDirection])
    const ids = await runStaging(
      db,
      { artDirector: director, fetchFn: await fakeImagesFetch(), apiKey: 'sk-test' },
      { designId, dataDir }
    )
    expect(ids).toHaveLength(4)
    expect(director.calls).toBe(2)
  })

  it('throws when validation still fails after the retry', async () => {
    const bad: ArtDirection = { ...goodDirection, product_lock: 'Keep it the same.' }
    const director = fakeDirector([bad, bad])
    await expect(
      runStaging(
        db,
        { artDirector: director, fetchFn: await fakeImagesFetch(), apiKey: 'sk-test' },
        { designId, dataDir }
      )
    ).rejects.toThrow(/PRODUCT LOCK/)
  })

  it('rejects a source photo from another design', async () => {
    const otherId = createDesign(db, { family: 'figure', name: 'Lovers Embrace' })
    const otherPiece = addPiece(db, {
      design_id: otherId, colorway: 'brown', height_in: 8, width_in: 4, depth_in: 3, weight_lb: 3,
    })
    const strangerPhoto = addPhoto(db, { piece_id: otherPiece, file_path: '/tmp/other.jpg', position: 0 })
    await expect(
      runStaging(
        db,
        { artDirector: fakeDirector([goodDirection]), fetchFn: await fakeImagesFetch(), apiKey: 'sk-test' },
        { designId, dataDir, sourcePhotoId: strangerPhoto }
      )
    ).rejects.toThrow(/not a photo of design/)
  })

  it('variance mode makes four n=1 calls with distinct compositions', async () => {
    const director = fakeDirector([goodDirection])
    const counter = { calls: 0, ns: [] as number[] }
    const ids = await runStaging(
      db,
      { artDirector: director, fetchFn: await fakeImagesFetch(counter), apiKey: 'sk-test' },
      { designId, dataDir, sceneKey: 'coffee-table', variance: true }
    )
    expect(ids).toHaveLength(4)
    expect(director.variedCalls).toBe(1)
    expect(director.calls).toBe(0)
    expect(director.lastImageCount).toBe(2) // primary + one supporting view
    expect(counter.calls).toBe(4)
    expect(counter.ns).toEqual([1, 1, 1, 1])
    const prompts = listStagedForDesign(db, designId).map((r) => r.prompt)
    expect(new Set(prompts).size).toBe(4) // each candidate carries its own composition
    for (const p of prompts) expect(p).toContain('never composited')
  })

  it('variance references never cross into another piece or colorway', async () => {
    const otherPieceId = addPiece(db, {
      design_id: designId, colorway: 'midnight', height_in: 0.3, width_in: 3.8, depth_in: 3.8, weight_lb: 6.5,
    })
    const otherPhotoPath = path.join(dataDir, 'midnight.jpg')
    await sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 20, g: 30, b: 60 } } })
      .jpeg()
      .toFile(otherPhotoPath)
    addPhoto(db, { piece_id: otherPieceId, file_path: otherPhotoPath, position: 0 })

    const director = fakeDirector([goodDirection])
    await runStaging(
      db,
      { artDirector: director, fetchFn: await fakeImagesFetch(), apiKey: 'sk-test' },
      { designId, dataDir, sceneKey: 'coffee-table', variance: true }
    )

    expect(director.lastImageCount).toBe(2)
  })

  it('non-variance behavior is unchanged: one n=4 call', async () => {
    const director = fakeDirector([goodDirection])
    const counter = { calls: 0, ns: [] as number[] }
    await runStaging(
      db,
      { artDirector: director, fetchFn: await fakeImagesFetch(counter), apiKey: 'sk-test' },
      { designId, dataDir, sceneKey: 'coffee-table' }
    )
    expect(counter.calls).toBe(1)
    expect(counter.ns).toEqual([4])
    expect(director.variedCalls).toBe(0)
  })

  it('uses an injected image provider and records its label', async () => {
    const ids = await runStaging(
      db,
      {
        artDirector: fakeDirector([goodDirection]),
        imageGenerator: await fakeImageGenerator(),
      },
      { designId, dataDir, sceneKey: 'coffee-table' }
    )

    expect(ids).toHaveLength(4)
    for (const row of listStagedForDesign(db, designId)) {
      expect(row.model).toBe('codex:image_generation')
    }
  })

  const chatPlan = (photoId: number): StagingPlan => ({
    scene: 'Photorealistic editorial product photograph on a dresser with a thin gold chain draped over the rim.',
    lighting:
      "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination with directionally consistent contact shadows on the dresser.",
    subject_and_count: 'Image 1 is the only product reference. Show exactly one coaster set of exactly four coasters, appearing exactly once.',
    composition: 'Slightly left of center at realistic 3.8-inch scale.',
    product_lock: 'Use the exact physical product from Image 1. Preserve the painted artwork. Do not restyle, redraw, smooth, or symmetrize.',
    extra_exclusions: [],
    size: '1536x1024',
    reference_photo_ids: [photoId],
    n: 4,
  })

  it('runPlannedBatch generates the planned batch under scene_key chat', async () => {
    const pid = getDesignDetail(db, designId)!.pieces[0].photos[0].photo_id
    const counter = { calls: 0, ns: [] as number[] }
    const ids = await runPlannedBatch(
      db,
      { fetchFn: await fakeImagesFetch(counter), apiKey: 'sk-test' },
      { designId, dataDir, plan: chatPlan(pid) }
    )
    expect(ids).toHaveLength(4)
    expect(counter.ns).toEqual([4])
    const rows = listStagedForDesign(db, designId).slice(0, 4)
    for (const r of rows) {
      expect(r.scene_key).toBe('chat')
      expect(r.prompt).toContain('gold chain')
      expect(r.prompt).toContain('never composited')
    }
  })

  it('runPlannedBatch rejects an invalid plan', async () => {
    const pid = getDesignDetail(db, designId)!.pieces[0].photos[0].photo_id
    const bad = { ...chatPlan(pid), lighting: 'soft light' }
    await expect(
      runPlannedBatch(db, { fetchFn: await fakeImagesFetch(), apiKey: 'sk-test' }, { designId, dataDir, plan: bad })
    ).rejects.toThrow(/never composited/)
  })

  it('preset staging passes owner notes to the art director', async () => {
    const chat = getOrCreateChatForDesign(db, designId)
    setStagingNotes(db, chat.chat_id, 'always show the painted faces toward camera')
    let seenUserText = ''
    const director: ArtDirector = {
      label: 'claude-opus-4-8',
      async direct(userText) {
        seenUserText = userText
        return { direction: goodDirection, input_tokens: 10, output_tokens: 10 }
      },
      async directVaried() {
        throw new Error('not used')
      },
    }
    await runStaging(
      db,
      { artDirector: director, fetchFn: await fakeImagesFetch(), apiKey: 'sk-test' },
      { designId, dataDir, sceneKey: 'coffee-table' }
    )
    expect(seenUserText).toMatch(/painted faces toward camera/)
  })
})
