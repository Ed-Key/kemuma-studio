import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto, listEvents } from '@/lib/catalog/catalog'
import {
  createStagedImage, getStagedImage, listStagedForDesign, sceneUsageForDesign,
  approveStagedImage, rejectStagedImage, listApprovedImages, DESTINATIONS, markStagedUploaded,
  type RejectReason,
} from '@/lib/catalog/staged'

function tempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-staged-')), 'catalog.sqlite')
}

describe('staged images', () => {
  let db: Db
  let designId: number
  let photoId: number

  beforeEach(() => {
    db = openDb(tempDbPath())
    designId = createDesign(db, { family: 'coaster set', name: 'Safari Sunset Coasters' })
    const pieceId = addPiece(db, {
      design_id: designId, colorway: 'sunset', height_in: 0.3, width_in: 3.8, depth_in: 3.8, weight_lb: 6.5,
    })
    photoId = addPhoto(db, { piece_id: pieceId, file_path: '/tmp/x.jpg', position: 0 })
  })

  function stage(sceneKey = 'coffee-table'): number {
    return createStagedImage(db, {
      design_id: designId,
      scene_key: sceneKey,
      source_photo_id: photoId,
      prompt: 'SCENE - test prompt',
      file_path: `/tmp/staged-${sceneKey}.png`,
      model: 'gpt-image-2-2026-04-21',
      cost_usd: 0.18,
    })
  }

  it('creates candidates and lists them newest first', () => {
    const a = stage('coffee-table')
    const b = stage('bar-cart')
    const rows = listStagedForDesign(db, designId)
    expect(rows.map((r) => r.staged_id)).toEqual([b, a])
    expect(rows[0]).toMatchObject({ status: 'candidate', destination: null, scene_key: 'bar-cart' })
    expect(getStagedImage(db, a)?.cost_usd).toBeCloseTo(0.18)
    expect(listEvents(db).some((e) => e.type === 'stage.generated')).toBe(true)
  })

  it('counts scene usage for rotation', () => {
    stage('coffee-table')
    stage('coffee-table')
    stage('bar-cart')
    expect(sceneUsageForDesign(db, designId)).toEqual({ 'coffee-table': 2, 'bar-cart': 1 })
  })

  it('approves with a destination and rejects', () => {
    const a = stage()
    const b = stage()
    approveStagedImage(db, { staged_id: a, destination: 'pinterest' })
    rejectStagedImage(db, b, 'not_wanted')
    expect(getStagedImage(db, a)).toMatchObject({
      status: 'approved',
      destination: 'pinterest',
      reject_reason: null,
    })
    expect(getStagedImage(db, b)).toMatchObject({
      status: 'rejected',
      destination: null,
      reject_reason: 'not_wanted',
    })
    const events = listEvents(db)
    const types = events.map((e) => e.type)
    expect(types).toContain('stage.approved')
    expect(types).toContain('stage.rejected')
    const rejected = events.find((e) => e.type === 'stage.rejected')
    expect(JSON.parse(rejected!.payload)).toEqual({ staged_id: b, reason: 'not_wanted', note: null })
  })

  it('rejects unknown reject reasons without changing the candidate', () => {
    const a = stage()
    expect(() => rejectStagedImage(db, a, 'too_dark' as RejectReason)).toThrow(
      'unknown reject reason "too_dark"'
    )
    expect(getStagedImage(db, a)).toMatchObject({
      status: 'candidate',
      destination: null,
      reject_reason: null,
    })
  })

  it('clears a previous reject reason when approved', () => {
    const a = stage()
    rejectStagedImage(db, a, 'lost_detail')
    approveStagedImage(db, { staged_id: a, destination: 'social' })
    expect(getStagedImage(db, a)).toMatchObject({
      status: 'approved',
      destination: 'social',
      reject_reason: null,
    })
  })

  it('rejects unknown destinations', () => {
    const a = stage()
    expect(() =>
      approveStagedImage(db, { staged_id: a, destination: 'etsy' as (typeof DESTINATIONS)[number] })
    ).toThrow(/destination/)
  })

  it('lists approved images with the design name', () => {
    const a = stage()
    stage() // stays candidate
    approveStagedImage(db, { staged_id: a, destination: 'social' })
    const approved = listApprovedImages(db)
    expect(approved).toHaveLength(1)
    expect(approved[0]).toMatchObject({ staged_id: a, design_name: 'Safari Sunset Coasters', destination: 'social' })
  })

  it('marks a scene as uploaded to etsy', () => {
    const a = stage()
    expect(getStagedImage(db, a)!.etsy_uploaded_at).toBeNull()
    markStagedUploaded(db, a)
    expect(getStagedImage(db, a)!.etsy_uploaded_at).toBeTruthy()
    expect(listEvents(db).some((e) => e.type === 'stage.attached')).toBe(true)
  })
})

function seedOne() {
  const db = openDb(tempDbPath())
  const designId = createDesign(db, { family: 'sculpture', name: 'Standing Head' })
  const pieceId = addPiece(db, {
    design_id: designId, colorway: 'natural', height_in: 8, width_in: 3, depth_in: 3, weight_lb: 2,
  })
  const photoId = addPhoto(db, { piece_id: pieceId, file_path: '/tmp/h.jpg', position: 0 })
  return { db, designId, photoId }
}

describe('reject notes', () => {
  it('keeps the observation the six categories cannot hold', () => {
    const { db, designId, photoId } = seedOne()
    const id = createStagedImage(db, {
      design_id: designId, scene_key: 'hard-sun-wall', source_photo_id: photoId,
      prompt: 'p', file_path: '/tmp/a.png', model: 'm', cost_usd: 0.21,
    })
    rejectStagedImage(db, id, 'looks_fake', '  wall shadow and cast shadow disagree about the light  ')
    const row = getStagedImage(db, id)!
    expect(row.reject_reason).toBe('looks_fake')
    expect(row.reject_note).toBe('wall shadow and cast shadow disagree about the light')
  })

  it('stores no note rather than an empty one', () => {
    const { db, designId, photoId } = seedOne()
    const id = createStagedImage(db, {
      design_id: designId, scene_key: 'hard-sun-wall', source_photo_id: photoId,
      prompt: 'p', file_path: '/tmp/b.png', model: 'm', cost_usd: 0.21,
    })
    rejectStagedImage(db, id, 'not_wanted', '   ')
    expect(getStagedImage(db, id)!.reject_note).toBeNull()
  })

  it('clears the note when a rejected image is later approved', () => {
    const { db, designId, photoId } = seedOne()
    const id = createStagedImage(db, {
      design_id: designId, scene_key: 'hard-sun-wall', source_photo_id: photoId,
      prompt: 'p', file_path: '/tmp/c.png', model: 'm', cost_usd: 0.21,
    })
    rejectStagedImage(db, id, 'looks_fake', 'shadows off')
    approveStagedImage(db, { staged_id: id, destination: 'social' })
    const row = getStagedImage(db, id)!
    expect(row.reject_reason).toBeNull()
    expect(row.reject_note).toBeNull()
  })
})
