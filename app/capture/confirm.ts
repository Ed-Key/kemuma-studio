'use server'

import { revalidatePath } from 'next/cache'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { addPhoto, addPiece, createDesign, getDesignDetail, logEvent } from '@/lib/catalog/catalog'
import { getCatalogDb, dataDir } from '@/lib/catalog/instance'
import { confirmIntake, getIntake, type CapturedFacts } from '@/lib/catalog/intakes'
import { create as createJob } from '@/lib/catalog/jobs'
import { photoDiskPath, savePhotoFile } from '@/lib/catalog/photos-fs'
import { addVideo } from '@/lib/catalog/videos'
import { runJobOperation, type JobInput } from '@/lib/jobs/operations'
import { startJob } from '@/lib/jobs/schedule'
import { pickSceneForFamily } from '@/lib/staging/pick-scene'
import type { MatchProposal } from '@/lib/matcher/schema'
import type { ActionResult } from '../components/action-result'

/**
 * Accept a captured object without going back to the desk.
 *
 * There is nothing to type here, which is the whole point: the measurements
 * were taken with the piece in hand, so the only open question is which design
 * this belongs to. The matcher already downgrades anything below high
 * confidence to abstain, so an "existing" proposal is the one case where a
 * single tap is honest.
 *
 * Confirming is also what makes the work possible: until a piece exists there
 * is no design to write copy about or stage a scene for.
 */
export async function confirmCapturedAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const db = getCatalogDb()
    const intakeId = Number(formData.get('intake_id'))
    const intake = getIntake(db, intakeId)
    if (!intake || intake.status !== 'pending') throw new Error('already confirmed')

    const facts = JSON.parse(intake.facts_json ?? '{}') as CapturedFacts
    const proposal = JSON.parse(intake.proposal_json ?? 'null') as MatchProposal | null
    const choice = String(formData.get('choice'))

    let designId: number
    if (choice === 'existing') {
      const id = proposal?.design_id ?? Number(formData.get('design_id'))
      if (!Number.isFinite(id)) throw new Error('no design to attach this to')
      designId = id
    } else {
      const name = String(formData.get('new_name') ?? '').trim()
      const family = String(formData.get('new_family') ?? '').trim()
      if (!name || !family) throw new Error('a new design needs a name and a family')
      designId = createDesign(db, { name, family })
    }

    const missing = (['height_in', 'width_in', 'depth_in', 'weight_lb'] as const).filter((k) => !facts[k])
    if (missing.length > 0) throw new Error(`measure ${missing.join(', ').replace(/_in|_lb/g, '')} first`)

    const pieceId = addPiece(db, {
      design_id: designId,
      colorway: facts.colorway || 'natural',
      height_in: facts.height_in!,
      width_in: facts.width_in!,
      depth_in: facts.depth_in!,
      weight_lb: facts.weight_lb!,
      quantity: Math.max(1, Math.floor(facts.quantity ?? 1)),
    })

    const staged = JSON.parse(intake.photos_json) as string[]
    for (const [position, src] of staged.entries()) {
      const dest = photoDiskPath(dataDir(), pieceId, position, path.basename(src))
      await savePhotoFile(dest, await readFile(src))
      const photoId = addPhoto(db, { piece_id: pieceId, file_path: dest, position })
      if (facts.dimension_index === position) {
        db.prepare('UPDATE photos SET dimension_shot = 1 WHERE photo_id = ?').run(photoId)
      }
    }

    for (const [i, src] of (JSON.parse(intake.videos_json ?? '[]') as string[]).entries()) {
      const dest = path.join(dataDir(), 'videos', String(pieceId), `${i}${path.extname(src)}`)
      await mkdir(path.dirname(dest), { recursive: true })
      await writeFile(dest, await readFile(src))
      addVideo(db, { piece_id: pieceId, file_path: dest })
    }

    confirmIntake(db, intakeId)
    logEvent(db, 'match.confirmed', {
      intake_id: intakeId,
      proposal,
      chosen_design_id: designId,
      verdict: proposal?.decision === 'existing'
        ? designId === proposal.design_id ? 'correct-merge' : 'false-merge'
        : choice === 'new' ? 'correct-new' : 'false-split',
      from: 'capture',
    })

    const detail = getDesignDetail(db, designId)!
    const started: string[] = []

    // Copy first, and only for a design that has none. A second piece of a
    // design already written about needs no new listing.
    const hasDraft = db
      .prepare('SELECT 1 FROM drafts WHERE design_id = ? LIMIT 1')
      .get(designId)
    if (!hasDraft) {
      const input: JobInput = { kind: 'listing_copy', designId }
      const jobId = createJob(db, {
        kind: 'listing_copy',
        design_id: designId,
        title: `Listing copy · ${detail.name}`,
        destination: `/designs/${designId}/draft`,
        input,
      })
      startJob(db, jobId, () => runJobOperation(db, input, jobId))
      started.push('listing copy')
    }

    // One batch, not two. Four images is $0.85 and enough to tell whether the
    // scene works at all; a second batch fired blind would usually be wrong the
    // same way as the first.
    const sceneKey = pickSceneForFamily(db, designId, detail.family)
    const stagingInput: JobInput = {
      kind: 'staging_batch',
      designId,
      sceneKey,
      variance: true,
    }
    const stagingJob = createJob(db, {
      kind: 'staging_batch',
      design_id: designId,
      title: `Staging · ${detail.name}`,
      destination: `/designs/${designId}/staging`,
      input: stagingInput,
    })
    startJob(db, stagingJob, () => runJobOperation(db, stagingInput, stagingJob))
    started.push(`staging on ${sceneKey}`)

    revalidatePath('/capture')
    revalidatePath('/designs')
    return {
      ok: true,
      message: `${detail.name} catalogued.`,
      detail: `${started.join(' and ')} running in the rail`,
    }
  } catch (err) {
    return {
      ok: false,
      message: 'Could not confirm this object.',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
