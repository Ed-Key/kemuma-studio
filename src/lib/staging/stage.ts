import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Db } from '@/lib/catalog/db'
import { getDesignDetail, getPhotoPath } from '@/lib/catalog/catalog'
import { stagingNotesForDesign } from '@/lib/catalog/chats'
import { createStagedImage, sceneUsageForDesign } from '@/lib/catalog/staged'
import { imageToApiBlock } from '@/lib/images/prepare'
import { computeCostUsd } from '@/lib/writer/prices'
import { getScene, pickScene } from './scenes'
import { assembleStagingPrompt, validateStagingPrompt } from './prompt'
import { buildDirectorUserText, buildVarianceDirectorUserText, type ArtDirector } from './direct'
import { createOpenAIImageGenerator, prepareReference, type ImageGenerator } from './images-api'
import { assemblePlanPrompt, validatePlan, type StagingPlan } from './plan'

type ImageGeneratorDeps =
  | { imageGenerator: ImageGenerator }
  | { fetchFn: typeof fetch; apiKey: string }

function imageGeneratorFrom(deps: ImageGeneratorDeps): ImageGenerator {
  return 'imageGenerator' in deps
    ? deps.imageGenerator
    : createOpenAIImageGenerator({ fetchFn: deps.fetchFn, apiKey: deps.apiKey })
}

export async function runStaging(
  db: Db,
  deps: { artDirector: ArtDirector } & ImageGeneratorDeps,
  input: { designId: number; dataDir: string; sceneKey?: string; sourcePhotoId?: number; n?: number; variance?: boolean }
): Promise<number[]> {
  const n = input.n ?? 4
  const imageGenerator = imageGeneratorFrom(deps)
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

  const baseInput = {
    name: detail.name,
    family: detail.family,
    colorway: piece.colorway,
    height_in: piece.height_in,
    width_in: piece.width_in,
    depth_in: piece.depth_in,
    quantity: piece.quantity,
    scene,
    stagingNotes: stagingNotesForDesign(db, input.designId) ?? undefined,
  }

  const outDir = path.join(input.dataDir, 'staged', String(input.designId))
  await mkdir(outDir, { recursive: true })
  const stamp = Date.now()

  async function persist(images: Buffer[], prompts: string[], costPerImage: number): Promise<number[]> {
    const ids: number[] = []
    for (const [i, image] of images.entries()) {
      const filePath = path.join(outDir, `${scene.key}-${stamp}-${i}.png`)
      await writeFile(filePath, image)
      ids.push(
        createStagedImage(db, {
          design_id: input.designId,
          scene_key: scene.key,
          source_photo_id: photoId!,
          prompt: prompts[i],
          file_path: filePath,
          model: imageGenerator.label,
          cost_usd: costPerImage,
        })
      )
    }
    return ids
  }

  if (input.variance) {
    // Variance mode: primary photo plus up to two more angles give the
    // director real geometry; four distinct compositions become four n=1
    // generations sharing the same reference set.
    const allPhotoIds = piece.photos.map((ph) => ph.photo_id)
    const supporting = allPhotoIds.filter((id) => id !== photoId)
    // Spread supporting picks across the list for angle diversity.
    const picks = [photoId!]
    if (supporting.length > 0) picks.push(supporting[0])
    if (supporting.length > 2) picks.push(supporting[Math.floor(supporting.length / 2)])
    else if (supporting.length === 2) picks.push(supporting[1])

    const photoPaths = picks
      .map((id) => getPhotoPath(db, id))
      .filter((p): p is string => p !== null)
    const directorImages = await Promise.all(photoPaths.map((p) => imageToApiBlock(p)))
    const references = await Promise.all(photoPaths.map((p) => prepareReference(p, scene.size)))

    const userText = buildVarianceDirectorUserText({ ...baseInput, referenceCount: photoPaths.length })
    let out = await deps.artDirector.directVaried(userText, directorImages)
    let directorIn = out.input_tokens
    let directorOut = out.output_tokens

    const build = (dir: { subject_and_count: string; product_lock: string; extra_exclusions: string[]; compositions: readonly string[] }) =>
      dir.compositions.map((composition) =>
        assembleStagingPrompt(scene, {
          subject_and_count: dir.subject_and_count,
          product_lock: dir.product_lock,
          extra_exclusions: dir.extra_exclusions,
          composition,
        })
      )

    let prompts = build(out.direction)
    let errors = prompts.flatMap((p) => validateStagingPrompt(p))
    if (errors.length > 0) {
      const feedback = `${userText}\n\nYour previous sections broke these prompt rules; fix them:\n- ${[...new Set(errors)].join('\n- ')}`
      out = await deps.artDirector.directVaried(feedback, directorImages)
      directorIn += out.input_tokens
      directorOut += out.output_tokens
      prompts = build(out.direction)
      errors = prompts.flatMap((p) => validateStagingPrompt(p))
      if (errors.length > 0) throw new Error(`staging prompt failed validation after retry: ${[...new Set(errors)].join('; ')}`)
    }

    const batches = await Promise.all(
      prompts.map((p) =>
        imageGenerator.generate({ references, prompt: p, size: scene.size, n: 1 })
      )
    )
    const directorCost = computeCostUsd(deps.artDirector.label, directorIn, directorOut) ?? 0
    const imagesCost = batches.reduce((sum, b) => sum + b.cost_usd, 0)
    const costPerImage = (imagesCost + directorCost) / batches.length
    return persist(
      batches.map((b) => b.images[0]),
      prompts,
      costPerImage
    )
  }

  const userText = buildDirectorUserText(baseInput)
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
  const batch = await imageGenerator.generate({ references: [reference], prompt, size: scene.size, n })

  const directorCost = computeCostUsd(deps.artDirector.label, directorIn, directorOut) ?? 0
  const costPerImage = (batch.cost_usd + directorCost) / batch.images.length
  return persist(
    batch.images,
    batch.images.map(() => prompt),
    costPerImage
  )
}

export async function runPlannedBatch(
  db: Db,
  deps: ImageGeneratorDeps,
  input: { designId: number; dataDir: string; plan: StagingPlan }
): Promise<number[]> {
  const imageGenerator = imageGeneratorFrom(deps)
  const errors = validatePlan(db, input.designId, input.plan)
  if (errors.length > 0) throw new Error(`plan failed validation: ${errors.join('; ')}`)

  const photoPaths = input.plan.reference_photo_ids
    .map((id) => getPhotoPath(db, id))
    .filter((p): p is string => p !== null)
  if (photoPaths.length === 0) throw new Error('no readable reference photos')
  const references = await Promise.all(photoPaths.map((p) => prepareReference(p, input.plan.size)))
  const prompt = assemblePlanPrompt(input.plan)

  const batch = await imageGenerator.generate({
    references,
    prompt,
    size: input.plan.size,
    n: input.plan.n,
  })

  const outDir = path.join(input.dataDir, 'staged', String(input.designId))
  await mkdir(outDir, { recursive: true })
  const stamp = Date.now()
  const costPerImage = batch.cost_usd / batch.images.length
  const ids: number[] = []
  for (const [i, image] of batch.images.entries()) {
    const filePath = path.join(outDir, `chat-${stamp}-${i}.png`)
    await writeFile(filePath, image)
    ids.push(
      createStagedImage(db, {
        design_id: input.designId,
        scene_key: 'chat',
        source_photo_id: input.plan.reference_photo_ids[0],
        prompt,
        file_path: filePath,
        model: imageGenerator.label,
        cost_usd: costPerImage,
      })
    )
  }
  return ids
}
