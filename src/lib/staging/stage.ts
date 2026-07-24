import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Db } from '@/lib/catalog/db'
import { getDesignDetail, getPhotoPath } from '@/lib/catalog/catalog'
import { createStagedImage, sceneUsageForDesign } from '@/lib/catalog/staged'
import { imageToApiBlock } from '@/lib/images/prepare'
import { computeCostUsd } from '@/lib/writer/prices'
import { getScene, pickScene } from './scenes'
import { assembleStagingPrompt, validateStagingPrompt } from './prompt'
import { buildDirectorUserText, type ArtDirector } from './direct'
import { generateStagedImages, prepareReference, GPT_IMAGE_MODEL } from './images-api'

export async function runStaging(
  db: Db,
  deps: { artDirector: ArtDirector; fetchFn: typeof fetch; apiKey: string },
  input: { designId: number; dataDir: string; sceneKey?: string; sourcePhotoId?: number; n?: number }
): Promise<number[]> {
  const n = input.n ?? 4
  const detail = getDesignDetail(db, input.designId)
  if (!detail) throw new Error(`design ${input.designId} not found`)

  // Source photo: caller's choice, or the design's cover (first photo of the
  // first piece). The photo must belong to this design.
  let piece = detail.pieces.find((p) => p.photos.length > 0)
  let photoId = piece?.photos[0]?.photo_id
  if (input.sourcePhotoId !== undefined) {
    piece = detail.pieces.find((p) => p.photos.some((ph) => ph.photo_id === input.sourcePhotoId))
    if (!piece) throw new Error(`photo ${input.sourcePhotoId} is not a photo of design ${input.designId}`)
    photoId = input.sourcePhotoId
  }
  if (!piece || photoId === undefined) throw new Error(`design ${input.designId} has no photos to stage from`)
  const photoPath = getPhotoPath(db, photoId)
  if (!photoPath) throw new Error(`photo ${photoId} has no file`)

  const scene = input.sceneKey
    ? getScene(input.sceneKey)
    : pickScene(detail.family, sceneUsageForDesign(db, input.designId))

  const userText = buildDirectorUserText({
    name: detail.name,
    family: detail.family,
    colorway: piece.colorway,
    height_in: piece.height_in,
    width_in: piece.width_in,
    depth_in: piece.depth_in,
    quantity: piece.quantity,
    scene,
  })
  const directorImage = await imageToApiBlock(photoPath)

  let directorIn = 0
  let directorOut = 0
  let out = await deps.artDirector.direct(userText, directorImage)
  directorIn += out.input_tokens
  directorOut += out.output_tokens
  let prompt = assembleStagingPrompt(scene, out.direction)
  let errors = validateStagingPrompt(prompt)
  if (errors.length > 0) {
    const feedback = `${userText}\n\nYour previous sections broke these prompt rules; fix them:\n- ${errors.join('\n- ')}`
    out = await deps.artDirector.direct(feedback, directorImage)
    directorIn += out.input_tokens
    directorOut += out.output_tokens
    prompt = assembleStagingPrompt(scene, out.direction)
    errors = validateStagingPrompt(prompt)
    if (errors.length > 0) throw new Error(`staging prompt failed validation after retry: ${errors.join('; ')}`)
  }

  const reference = await prepareReference(photoPath, scene.size)
  const batch = await generateStagedImages(deps.fetchFn, deps.apiKey, { reference, prompt, size: scene.size, n })

  const directorCost = computeCostUsd(deps.artDirector.label, directorIn, directorOut) ?? 0
  const costPerImage = (batch.cost_usd + directorCost) / batch.images.length

  const outDir = path.join(input.dataDir, 'staged', String(input.designId))
  await mkdir(outDir, { recursive: true })
  const stamp = Date.now()
  const ids: number[] = []
  for (const [i, image] of batch.images.entries()) {
    const filePath = path.join(outDir, `${scene.key}-${stamp}-${i}.png`)
    await writeFile(filePath, image)
    ids.push(
      createStagedImage(db, {
        design_id: input.designId,
        scene_key: scene.key,
        source_photo_id: photoId,
        prompt,
        file_path: filePath,
        model: GPT_IMAGE_MODEL,
        cost_usd: costPerImage,
      })
    )
  }
  return ids
}
