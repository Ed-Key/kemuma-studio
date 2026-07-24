'use server'

import { revalidatePath } from 'next/cache'
import { getCatalogDb, dataDir } from '@/lib/catalog/instance'
import { approveStagedImage, rejectStagedImage, DESTINATIONS, type Destination } from '@/lib/catalog/staged'
import { createClaudeArtDirector } from '@/lib/staging/direct'
import { runStaging } from '@/lib/staging/stage'
import type { ActionResult } from '../../../components/action-result'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function stageDesignAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const sceneKey = String(formData.get('scene_key') ?? 'auto')
    const photoRaw = String(formData.get('source_photo_id') ?? '')
    const variance = formData.get('variance') === 'on'
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
    const ids = await runStaging(
      getCatalogDb(),
      { artDirector: createClaudeArtDirector(), fetchFn: fetch, apiKey },
      {
        designId,
        dataDir: dataDir(),
        sceneKey: sceneKey === 'auto' ? undefined : sceneKey,
        sourcePhotoId: photoRaw ? Number(photoRaw) : undefined,
        variance,
      }
    )
    revalidatePath(`/designs/${designId}/staging`)
    return { ok: true, message: `Staged ${ids.length} candidate scenes.` }
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
    rejectStagedImage(getCatalogDb(), stagedId)
    revalidatePath(`/designs/${designId}/staging`)
    return { ok: true, message: 'Rejected.' }
  } catch (err) {
    return { ok: false, message: 'Could not reject the image.', detail: errText(err) }
  }
}
