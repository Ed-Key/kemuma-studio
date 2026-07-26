'use server'

import { after } from 'next/server'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getCatalogDb, dataDir } from '@/lib/catalog/instance'
import { createIntake, setIntakeProposal, type CapturedFacts } from '@/lib/catalog/intakes'
import { proposeMatch } from '@/lib/matcher/match'
import { defaultMatcher } from '@/lib/matcher/match-openai'
import type { ActionResult } from '../components/action-result'

const PHOTOS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic'])
const VIDEOS = new Set(['.mov', '.mp4', '.m4v'])

function optionalNumber(formData: FormData, key: string): number | undefined {
  const raw = String(formData.get(key) ?? '').trim()
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key.replace(/_/g, ' ')} must be a positive number`)
  return value
}

/**
 * One object, captured in the garage.
 *
 * Every "next object" is its own submit rather than one upload at the end,
 * because garage wifi is unreliable and a failed post should cost one piece
 * rather than an afternoon.
 *
 * The measurements are the point. They cannot be recovered from a photograph
 * and this is the only moment they are cheap to take, so they ride along with
 * the images instead of being estimated at a desk later.
 */
export async function captureObjectAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const files = formData.getAll('media').filter((f): f is File => f instanceof File && f.size > 0)
    // Its own control rather than picking an index out of the batch: on a phone
    // the whole-piece shot is one deliberate photograph, and choosing it from a
    // grid of thumbnails afterwards is the fiddly kind of tap this screen is
    // trying to avoid.
    const dimensionShot = formData.get('dimension_media')
    const dimension = dimensionShot instanceof File && dimensionShot.size > 0 ? dimensionShot : null
    if (files.length === 0 && !dimension) throw new Error('take at least one photo')

    const facts: CapturedFacts = {
      colorway: String(formData.get('colorway') ?? '').trim() || undefined,
      height_in: optionalNumber(formData, 'height_in'),
      width_in: optionalNumber(formData, 'width_in'),
      depth_in: optionalNumber(formData, 'depth_in'),
      weight_lb: optionalNumber(formData, 'weight_lb'),
      quantity: optionalNumber(formData, 'quantity'),
      note: String(formData.get('note') ?? '').trim() || undefined,
    }

    const dir = path.join(dataDir(), 'intake', String(Date.now()))
    await mkdir(dir, { recursive: true })
    const photos: string[] = []
    const videos: string[] = []
    const save = async (file: File, name: string) => {
      const ext = path.extname(file.name).toLowerCase()
      const isPhoto = PHOTOS.has(ext)
      if (!isPhoto && !VIDEOS.has(ext)) throw new Error(`unsupported file: ${file.name}`)
      const dest = path.join(dir, `${name}${ext}`)
      await writeFile(dest, Buffer.from(await file.arrayBuffer()))
      ;(isPhoto ? photos : videos).push(dest)
      return isPhoto
    }
    for (const [i, file] of files.entries()) await save(file, String(i))
    if (dimension) {
      if (!(await save(dimension, 'dimension'))) throw new Error('the dimension shot must be a photo')
      facts.dimension_index = photos.length - 1
    }
    if (photos.length === 0) throw new Error('at least one still photo is needed to match the design')

    const db = getCatalogDb()
    const intakeId = createIntake(db, {
      dir,
      photos_json: JSON.stringify(photos),
      facts_json: JSON.stringify(facts),
      videos_json: videos.length > 0 ? JSON.stringify(videos) : undefined,
    })

    // Matching is a model call against every photo. Awaiting it would leave the
    // owner standing in the garage watching a spinner, so it runs behind the
    // response and the intake shows as unmatched until it lands.
    after(async () => {
      try {
        const proposal = await proposeMatch(getCatalogDb(), defaultMatcher(), photos)
        setIntakeProposal(getCatalogDb(), intakeId, JSON.stringify(proposal))
      } catch {
        // An unmatched intake is still a captured object. The review screen
        // lets the owner pick the design by hand.
      }
    })

    const measured = facts.height_in && facts.width_in && facts.depth_in && facts.weight_lb
    return {
      ok: true,
      message: measured ? 'Saved with measurements.' : 'Saved. Measurements still missing.',
      detail: `${photos.length} photo${photos.length === 1 ? '' : 's'}${
        videos.length > 0 ? `, ${videos.length} clip${videos.length === 1 ? '' : 's'}` : ''
      }`,
    }
  } catch (err) {
    return {
      ok: false,
      message: 'Could not save this object.',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
