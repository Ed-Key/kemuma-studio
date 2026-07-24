import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto } from '@/lib/catalog/catalog'
import { listDimensionCardsForDesign } from '@/lib/catalog/dimcards'
import { generateDimensionCard } from '@/lib/dimcards/generate'
import type { CutoutRunner } from '@/lib/dimcards/cutout'

// Fake runner writing a centered opaque block with clear margins.
const okRunner: CutoutRunner = async (_src, out) => {
  const rect = await sharp({
    create: { width: 120, height: 300, channels: 4, background: { r: 90, g: 60, b: 40, alpha: 1 } },
  }).png().toBuffer()
  await sharp({
    create: { width: 400, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: rect, left: 100, top: 150 }]).png().toFile(out)
}

describe('generateDimensionCard', () => {
  let db: Db
  let dataDir: string
  let designId: number

  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'kemuma-gendim-'))
    db = openDb(path.join(dataDir, 'catalog.sqlite'))
    designId = createDesign(db, { family: 'figure', name: 'Lovers Loop Figure' })
    const pieceId = addPiece(db, {
      design_id: designId, colorway: 'brown', height_in: 6, width_in: 2.5, depth_in: 2, weight_lb: 1,
    })
    const photoPath = path.join(dataDir, 'photo.jpg')
    await sharp({ create: { width: 400, height: 600, channels: 3, background: '#cccccc' } })
      .jpeg().toFile(photoPath)
    addPhoto(db, { piece_id: pieceId, file_path: photoPath, position: 0 })
  })

  it('writes the card file and records the row with the piece dims', async () => {
    const cardId = await generateDimensionCard(db, okRunner, { designId, dataDir })
    const rows = listDimensionCardsForDesign(db, designId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ card_id: cardId, height_in: 6, width_in: 2.5, status: 'candidate' })
    expect(existsSync(rows[0].file_path)).toBe(true)
    const meta = await sharp(rows[0].file_path).metadata()
    expect(meta.width).toBe(2000)
  })

  it('surfaces the edge-cropped error', async () => {
    const cropped: CutoutRunner = async (_src, out) => {
      const rect = await sharp({
        create: { width: 120, height: 300, channels: 4, background: { r: 90, g: 60, b: 40, alpha: 1 } },
      }).png().toBuffer()
      await sharp({
        create: { width: 400, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).composite([{ input: rect, left: 100, top: 300 }]).png().toFile(out) // touches bottom edge
    }
    await expect(generateDimensionCard(db, cropped, { designId, dataDir })).rejects.toThrow(/photo edge/)
  })

  it('rejects a photo from another design', async () => {
    const otherId = createDesign(db, { family: 'figure', name: 'Other' })
    const otherPiece = addPiece(db, {
      design_id: otherId, colorway: 'gray', height_in: 5, width_in: 2, depth_in: 2, weight_lb: 1,
    })
    const strangerPhoto = addPhoto(db, { piece_id: otherPiece, file_path: '/tmp/other.jpg', position: 0 })
    await expect(
      generateDimensionCard(db, okRunner, { designId, dataDir, sourcePhotoId: strangerPhoto })
    ).rejects.toThrow(/not a photo of design/)
  })
})
