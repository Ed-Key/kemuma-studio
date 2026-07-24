import { mkdir } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Db } from '@/lib/catalog/db'
import { getDesignDetail, getPhotoPath } from '@/lib/catalog/catalog'
import { createDimensionCard } from '@/lib/catalog/dimcards'
import { cutoutProduct, type CutoutRunner } from './cutout'
import { composeDimensionCard } from './compose'

export async function generateDimensionCard(
  db: Db,
  runner: CutoutRunner,
  input: { designId: number; dataDir: string; sourcePhotoId?: number }
): Promise<number> {
  const detail = getDesignDetail(db, input.designId)
  if (!detail) throw new Error(`design ${input.designId} not found`)

  let piece = detail.pieces.find((p) => p.photos.length > 0)
  let photoId = piece?.photos[0]?.photo_id
  if (input.sourcePhotoId !== undefined) {
    piece = detail.pieces.find((p) => p.photos.some((ph) => ph.photo_id === input.sourcePhotoId))
    if (!piece) throw new Error(`photo ${input.sourcePhotoId} is not a photo of design ${input.designId}`)
    photoId = input.sourcePhotoId
  }
  if (!piece || photoId === undefined) throw new Error(`design ${input.designId} has no photos`)
  const photoPath = getPhotoPath(db, photoId)
  if (!photoPath) throw new Error(`photo ${photoId} has no file`)

  const outDir = path.join(input.dataDir, 'dimcards', String(input.designId))
  await mkdir(outDir, { recursive: true })
  const stamp = Date.now()
  const cutout = await cutoutProduct(runner, photoPath, path.join(outDir, `cutout-${stamp}.png`))
  const card = await composeDimensionCard({
    cutout: cutout.png,
    title: detail.name,
    heightIn: piece.height_in,
    widthIn: piece.width_in,
  })
  const filePath = path.join(outDir, `card-${stamp}.jpg`)
  await writeFile(filePath, card)
  return createDimensionCard(db, {
    design_id: input.designId,
    source_photo_id: photoId,
    file_path: filePath,
    height_in: piece.height_in,
    width_in: piece.width_in,
  })
}
