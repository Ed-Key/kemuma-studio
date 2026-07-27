import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto, listEvents } from '@/lib/catalog/catalog'
import {
  createDimensionCard, getDimensionCard, listDimensionCardsForDesign,
  markCardUploaded,
} from '@/lib/catalog/dimcards'

function tempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-dim-')), 'catalog.sqlite')
}

describe('dimension cards', () => {
  let db: Db
  let designId: number
  let photoId: number

  beforeEach(() => {
    db = openDb(tempDbPath())
    designId = createDesign(db, { family: 'figure', name: 'Lovers Loop Figure' })
    const pieceId = addPiece(db, {
      design_id: designId, colorway: 'brown', height_in: 6, width_in: 2.5, depth_in: 2, weight_lb: 1,
    })
    photoId = addPhoto(db, { piece_id: pieceId, file_path: '/tmp/x.jpg', position: 0 })
  })

  function card(): number {
    return createDimensionCard(db, {
      design_id: designId,
      source_photo_id: photoId,
      file_path: '/tmp/card.jpg',
      height_in: 6,
      width_in: 2.5,
    })
  }

  it('creates candidates and lists newest first', () => {
    const a = card()
    const b = card()
    expect(listDimensionCardsForDesign(db, designId).map((c) => c.card_id)).toEqual([b, a])
    expect(getDimensionCard(db, a)).toMatchObject({ status: 'candidate', height_in: 6, width_in: 2.5 })
    expect(listEvents(db).some((e) => e.type === 'dimcard.generated')).toBe(true)
  })

  it('marks a card as uploaded to etsy exactly once', () => {
    const a = card()
    expect(getDimensionCard(db, a)!.etsy_uploaded_at).toBeNull()
    markCardUploaded(db, a)
    const after = getDimensionCard(db, a)!
    expect(after.etsy_uploaded_at).toBeTruthy()
    expect(listEvents(db).some((e) => e.type === 'dimcard.attached')).toBe(true)
  })
})
