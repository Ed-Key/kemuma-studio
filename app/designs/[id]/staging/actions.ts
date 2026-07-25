'use server'

import { revalidatePath } from 'next/cache'
import { getCatalogDb, dataDir } from '@/lib/catalog/instance'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { create as createJob } from '@/lib/catalog/jobs'
import {
  approveStagedImage,
  getStagedImage,
  rejectStagedImage,
  DESTINATIONS,
  type Destination,
  type RejectReason,
} from '@/lib/catalog/staged'
import { runJobOperation, type JobInput } from '@/lib/jobs/operations'
import { startJob } from '@/lib/jobs/schedule'
import { getScene } from '@/lib/staging/scenes'
import { computeCostUsd } from '@/lib/writer/prices'
import type { ActionResult } from '../../../components/action-result'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function designForJob(designId: number) {
  if (!Number.isInteger(designId) || designId < 1) throw new Error('invalid design')
  const detail = getDesignDetail(getCatalogDb(), designId)
  if (!detail) throw new Error(`design ${designId} not found`)
  return detail
}

export async function stageDesignAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const sceneKey = String(formData.get('scene_key') ?? 'auto')
    const photoRaw = String(formData.get('source_photo_id') ?? '')
    const variance = formData.get('variance') === 'on'
    const sourcePhotoId = photoRaw ? Number(photoRaw) : undefined
    if (sourcePhotoId !== undefined && (!Number.isInteger(sourcePhotoId) || sourcePhotoId < 1)) {
      throw new Error('invalid source photo')
    }
    const detail = designForJob(designId)
    if (sceneKey !== 'auto') getScene(sceneKey)
    if (
      sourcePhotoId !== undefined
      && !detail.pieces.some((piece) =>
        piece.photos.some((photo) => photo.photo_id === sourcePhotoId)
      )
    ) {
      throw new Error(`photo ${sourcePhotoId} is not a photo of design ${designId}`)
    }
    const db = getCatalogDb()
    const destination = `/designs/${designId}/staging`
    const input: JobInput = {
      kind: 'staging_batch',
      designId,
      sceneKey: sceneKey === 'auto' ? undefined : sceneKey,
      sourcePhotoId,
      variance,
    }
    const jobId = createJob(db, {
      kind: 'staging_batch',
      design_id: designId,
      title: `Staging · ${detail.name}`,
      destination,
      input,
    })
    startJob(db, jobId, () => runJobOperation(db, input, jobId))
    return { ok: true, message: 'Staging started in the rail.', jobId }
  } catch (err) {
    return { ok: false, message: 'Could not stage the design.', detail: errText(err) }
  }
}

export async function approveStagedAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const stagedId = Number(formData.get('staged_id'))
    const destination = String(formData.get('destination')) as Destination
    if (!DESTINATIONS.includes(destination)) throw new Error(`pick a destination`)
    approveStagedImage(getCatalogDb(), { staged_id: stagedId, destination })
    revalidatePath(`/designs/${designId}/staging`)
    revalidatePath('/marketing')
    return { ok: true, message: `Approved for ${destination}.` }
  } catch (err) {
    return { ok: false, message: 'Could not approve the image.', detail: errText(err) }
  }
}

export async function rejectStagedAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const stagedId = Number(formData.get('staged_id'))
    const reason = String(formData.get('reason')) as RejectReason
    rejectStagedImage(getCatalogDb(), stagedId, reason)
    revalidatePath(`/designs/${designId}/staging`)
    return { ok: true, message: 'Rejected.' }
  } catch (err) {
    return { ok: false, message: 'Could not reject the image.', detail: errText(err) }
  }
}

export async function generateDimensionCardAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const photoRaw = String(formData.get('source_photo_id') ?? '')
    const { rembgRunner } = await import('@/lib/dimcards/cutout')
    const { generateDimensionCard } = await import('@/lib/dimcards/generate')
    await generateDimensionCard(getCatalogDb(), rembgRunner, {
      designId,
      dataDir: dataDir(),
      sourcePhotoId: photoRaw ? Number(photoRaw) : undefined,
    })
    revalidatePath(`/designs/${designId}/staging`)
    return { ok: true, message: 'Dimension card drawn from the catalog dims.' }
  } catch (err) {
    return { ok: false, message: 'Could not generate the dimension card.', detail: errText(err) }
  }
}

export async function approveDimensionCardAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const { approveDimensionCard } = await import('@/lib/catalog/dimcards')
    approveDimensionCard(getCatalogDb(), Number(formData.get('card_id')))
    revalidatePath(`/designs/${designId}/staging`)
    return { ok: true, message: 'Card approved. Eligible for the Etsy listing gallery.' }
  } catch (err) {
    return { ok: false, message: 'Could not approve the card.', detail: errText(err) }
  }
}

export async function rejectDimensionCardAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const { rejectDimensionCard } = await import('@/lib/catalog/dimcards')
    rejectDimensionCard(getCatalogDb(), Number(formData.get('card_id')))
    revalidatePath(`/designs/${designId}/staging`)
    return { ok: true, message: 'Card rejected.' }
  } catch (err) {
    return { ok: false, message: 'Could not reject the card.', detail: errText(err) }
  }
}

export async function attachCardToEtsyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const cardId = Number(formData.get('card_id'))
    const db = getCatalogDb()

    const { getDimensionCard, markCardUploaded } = await import('@/lib/catalog/dimcards')
    const { getDesignDetail } = await import('@/lib/catalog/catalog')
    const card = getDimensionCard(db, cardId)
    if (!card || card.design_id !== designId) throw new Error('card not found for this design')
    if (card.status !== 'approved') throw new Error('approve the card first')
    if (card.etsy_uploaded_at) throw new Error('card is already on the listing')
    const detail = getDesignDetail(db, designId)
    if (!detail?.etsy_listing_id) throw new Error('push the listing to Etsy first')

    const { readFile } = await import('node:fs/promises')
    const { createEtsyGateway } = await import('@/lib/etsy/gateway')
    const { getValidAccessToken } = await import('@/lib/etsy/tokens')
    const { etsyConfig } = await import('@/lib/etsy/config')
    const cfg = etsyConfig()
    const gateway = createEtsyGateway({
      keystring: cfg.keystring,
      sharedSecret: cfg.sharedSecret,
      getAccessToken: () => getValidAccessToken(fetch, cfg.dataDir, cfg.keystring),
    })
    const me = await gateway.getMe()
    await gateway.uploadListingImage(me.shop_id, detail.etsy_listing_id, await readFile(card.file_path), 'dimension-card.jpg', 10)
    markCardUploaded(db, cardId)
    revalidatePath(`/designs/${designId}/staging`)
    return { ok: true, message: 'Card added to the Etsy listing gallery.', detail: `listing ${detail.etsy_listing_id}` }
  } catch (err) {
    return { ok: false, message: 'Could not add the card to the listing.', detail: errText(err) }
  }
}

export async function attachSceneToEtsyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const stagedId = Number(formData.get('staged_id'))
    const db = getCatalogDb()

    const { getStagedImage, markStagedUploaded } = await import('@/lib/catalog/staged')
    const { getDesignDetail } = await import('@/lib/catalog/catalog')
    const scene = getStagedImage(db, stagedId)
    if (!scene || scene.design_id !== designId) throw new Error('scene not found for this design')
    if (scene.status !== 'approved') throw new Error('approve the scene first')
    if (scene.etsy_uploaded_at) throw new Error('scene is already on the listing')
    const detail = getDesignDetail(db, designId)
    if (!detail?.etsy_listing_id) throw new Error('push the listing to Etsy first')

    const sharp = (await import('sharp')).default
    const jpeg = await sharp(scene.file_path).jpeg({ quality: 92 }).toBuffer()
    const { createEtsyGateway } = await import('@/lib/etsy/gateway')
    const { getValidAccessToken } = await import('@/lib/etsy/tokens')
    const { etsyConfig } = await import('@/lib/etsy/config')
    const cfg = etsyConfig()
    const gateway = createEtsyGateway({
      keystring: cfg.keystring,
      sharedSecret: cfg.sharedSecret,
      getAccessToken: () => getValidAccessToken(fetch, cfg.dataDir, cfg.keystring),
    })
    const me = await gateway.getMe()
    await gateway.uploadListingImage(me.shop_id, detail.etsy_listing_id, jpeg, 'staged-scene.jpg', 10)
    markStagedUploaded(db, stagedId)
    revalidatePath(`/designs/${designId}/staging`)
    return { ok: true, message: 'Scene added to the Etsy listing gallery.', detail: `listing ${detail.etsy_listing_id}` }
  } catch (err) {
    return { ok: false, message: 'Could not add the scene to the listing.', detail: errText(err) }
  }
}

export async function chatTurnAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const message = String(formData.get('message') ?? '').trim()
    if (!message) throw new Error('write a message first')
    const detail = designForJob(designId)
    const { getOrCreateChatForDesign } = await import('@/lib/catalog/chats')
    const db = getCatalogDb()
    const chat = getOrCreateChatForDesign(db, designId)
    const input: JobInput = {
      kind: 'director_turn',
      designId,
      chatId: chat.chat_id,
      userText: message,
    }
    const destination = `/designs/${designId}/staging`
    const jobId = createJob(db, {
      kind: 'director_turn',
      design_id: designId,
      title: `Director · ${detail.name}`,
      destination,
      input,
    })
    startJob(db, jobId, () => runJobOperation(db, input, jobId))
    return { ok: true, message: 'The staging director is working in the rail.', jobId }
  } catch (err) {
    return { ok: false, message: 'The staging director could not respond.', detail: errText(err) }
  }
}

export async function executePlanAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const { getChatForDesign, setPendingPlan } = await import('@/lib/catalog/chats')
    const { StagingPlanSchema } = await import('@/lib/staging/plan')
    const { runPlannedBatch } = await import('@/lib/staging/stage')
    const db = getCatalogDb()
    const detail = designForJob(designId)
    const chat = getChatForDesign(db, designId)
    if (!chat?.pending_plan_json) throw new Error('no pending plan; ask the staging director first')
    const plan = StagingPlanSchema.parse(JSON.parse(chat.pending_plan_json))
    const destination = `/designs/${designId}/staging`
    const input: JobInput = {
      kind: 'planned_batch',
      designId,
      chatId: chat.chat_id,
      plan,
    }
    const jobId = createJob(db, {
      kind: 'planned_batch',
      design_id: designId,
      title: `Planned batch · ${detail.name}`,
      destination,
      input,
    })
    startJob(db, jobId, () => runJobOperation(db, input, jobId))
    return { ok: true, message: 'The planned batch started in the rail.', jobId }
  } catch (err) {
    return { ok: false, message: 'Could not run the chat plan.', detail: errText(err) }
  }
}

export async function discardPlanAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const { getChatForDesign, setPendingPlan } = await import('@/lib/catalog/chats')
    const db = getCatalogDb()
    const chat = getChatForDesign(db, designId)
    if (chat) setPendingPlan(db, chat.chat_id, null)
    revalidatePath(`/designs/${designId}/staging`)
    return { ok: true, message: 'Plan discarded.' }
  } catch (err) {
    return { ok: false, message: 'Could not discard the plan.', detail: errText(err) }
  }
}
