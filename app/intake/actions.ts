'use server'

import { redirect } from 'next/navigation'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { getCatalogDb, dataDir } from '@/lib/catalog/instance'
import { addPhoto, addPiece, createDesign, logEvent } from '@/lib/catalog/catalog'
import { createIntake, getIntake, confirmIntake } from '@/lib/catalog/intakes'
import { addVideo } from '@/lib/catalog/videos'
import { photoDiskPath, savePhotoFile } from '@/lib/catalog/photos-fs'
import { proposeMatch } from '@/lib/matcher/match'
import { defaultMatcher } from '@/lib/matcher/match-openai'
import type { MatchProposal } from '@/lib/matcher/schema'

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic'])

export async function createIntakeAction(formData: FormData) {
  const db = getCatalogDb()
  const files = formData.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) throw new Error('upload at least one photo')

  const stamp = Date.now()
  const dir = path.join(dataDir(), 'intake', String(stamp))
  await mkdir(dir, { recursive: true })
  const saved: string[] = []
  for (const [i, file] of files.entries()) {
    const ext = path.extname(file.name).toLowerCase()
    if (!ALLOWED.has(ext)) throw new Error(`unsupported photo type: ${file.name}`)
    const dest = path.join(dir, `${i}${ext}`)
    await writeFile(dest, Buffer.from(await file.arrayBuffer()))
    saved.push(dest)
  }

  const proposal = await proposeMatch(db, defaultMatcher(), saved)
  const intakeId = createIntake(db, { dir, photos_json: JSON.stringify(saved), proposal_json: JSON.stringify(proposal) })
  redirect(`/intake/${intakeId}`)
}

export async function confirmIntakeAction(formData: FormData) {
  const db = getCatalogDb()
  const intakeId = Number(formData.get('intake_id'))
  const intake = getIntake(db, intakeId)
  if (!intake || intake.status !== 'pending') throw new Error('intake not found or already confirmed')
  const proposal = JSON.parse(intake.proposal_json ?? 'null') as MatchProposal | null

  const choice = String(formData.get('choice'))
  const num = (key: string) => {
    const v = Number(formData.get(key))
    if (!Number.isFinite(v) || v <= 0) throw new Error(`${key} must be a positive number`)
    return v
  }

  let designId: number
  if (choice === 'new') {
    const name = String(formData.get('new_name') ?? '').trim()
    const family = String(formData.get('new_family') ?? '').trim()
    if (!name || !family) throw new Error('new designs need a name and family')
    designId = createDesign(db, { family, name })
  } else if (choice === 'proposed') {
    if (proposal?.design_id == null) throw new Error('no proposed design to accept')
    designId = proposal.design_id
  } else {
    designId = Number(formData.get('other_design_id'))
    if (!Number.isFinite(designId)) throw new Error('pick a design')
  }

  const pieceId = addPiece(db, {
    design_id: designId,
    colorway: String(formData.get('colorway') ?? '').trim() || 'natural',
    height_in: num('height_in'),
    width_in: num('width_in'),
    depth_in: num('depth_in'),
    weight_lb: num('weight_lb'),
    quantity: Math.max(1, Math.floor(Number(formData.get('quantity')) || 1)),
  })

  const staged = JSON.parse(intake.photos_json) as string[]
  for (const [position, src] of staged.entries()) {
    const dest = photoDiskPath(dataDir(), pieceId, position, path.basename(src))
    await savePhotoFile(dest, await readFile(src))
    addPhoto(db, { piece_id: pieceId, file_path: dest, position })
  }

  const clips = JSON.parse(intake.videos_json ?? '[]') as string[]
  for (const [i, src] of clips.entries()) {
    const dest = path.join(dataDir(), 'videos', String(pieceId), `${i}${path.extname(src)}`)
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, await readFile(src))
    addVideo(db, { piece_id: pieceId, file_path: dest })
  }

  confirmIntake(db, intakeId)
  let verdict: string
  if (!proposal || proposal.decision === 'abstain') verdict = 'abstain-resolved'
  else if (proposal.decision === 'existing') verdict = designId === proposal.design_id ? 'correct-merge' : 'false-merge'
  else verdict = choice === 'new' ? 'correct-new' : 'false-split'
  logEvent(db, 'match.confirmed', { intake_id: intakeId, proposal, chosen_design_id: designId, verdict })

  redirect(`/designs/${designId}`)
}
