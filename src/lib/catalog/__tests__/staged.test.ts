import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto, listEvents } from '@/lib/catalog/catalog'
import {
  createStagedImage, getStagedImage, listStagedForDesign, sceneUsageForDesign,
  approveStagedImage, rejectStagedImage, listApprovedImages, DESTINATIONS, markStagedUploaded,
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
    rejectStagedImage(db, b)
    expect(getStagedImage(db, a)).toMatchObject({ status: 'approved', destination: 'pinterest' })
    expect(getStagedImage(db, b)).toMatchObject({ status: 'rejected', destination: null })
    const types = listEvents(db).map((e) => e.type)
    expect(types).toContain('stage.approved')
    expect(types).toContain('stage.rejected')
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
