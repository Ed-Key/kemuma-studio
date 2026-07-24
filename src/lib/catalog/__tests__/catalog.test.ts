import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'

function tempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-db-')), 'catalog.sqlite')
}

describe('openDb', () => {
  it('creates the schema idempotently', () => {
    const file = tempDbPath()
    const db1 = openDb(file)
    db1.close()
    const db2 = openDb(file) // second open must not throw
    const tables = db2
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toEqual(expect.arrayContaining(['designs', 'events', 'photos', 'pieces']))
    db2.close()
  })

  it('enforces foreign keys', () => {
    const db = openDb(tempDbPath())
    expect(() =>
      db.prepare(
        "INSERT INTO pieces (design_id, colorway, height_in, width_in, depth_in, weight_lb) VALUES (999, 'gray', 5, 3, 3, 2)"
      ).run()
    ).toThrow(/FOREIGN KEY/)
    db.close()
  })
})

import {
  createDesign, listDesigns, getDesignDetail, addPiece, addPhoto, getPhotoPath, listEvents,
  setDesignEtsyListingId, markDesignPiecesListed, markDesignPublished,
} from '@/lib/catalog/catalog'

describe('catalog operations', () => {
  let db: Db
  beforeEach(() => {
    db = openDb(tempDbPath())
  })

  it('creates designs and lists them with piece counts', () => {
    const id = createDesign(db, { family: 'love knot', name: 'Eternity Love Knot' })
    addPiece(db, { design_id: id, colorway: 'gray', height_in: 5, width_in: 3, depth_in: 3, weight_lb: 2 })
    addPiece(db, { design_id: id, colorway: 'rose', height_in: 5, width_in: 3, depth_in: 3, weight_lb: 2, quantity: 3 })
    const designs = listDesigns(db)
    expect(designs).toHaveLength(1)
    expect(designs[0]).toMatchObject({ design_id: id, name: 'Eternity Love Knot', piece_count: 2, total_quantity: 4 })
  })

  it('rejects duplicate design names', () => {
    createDesign(db, { family: 'love knot', name: 'Eternity Love Knot' })
    expect(() => createDesign(db, { family: 'love knot', name: 'Eternity Love Knot' })).toThrow(/UNIQUE/)
  })

  it('returns full design detail with pieces and photos', () => {
    const id = createDesign(db, { family: 'bowl', name: 'Animal Bowl 4in' })
    const pieceId = addPiece(db, { design_id: id, colorway: 'natural', height_in: 2, width_in: 4, depth_in: 4, weight_lb: 1 })
    addPhoto(db, { piece_id: pieceId, file_path: 'data/photos/1/0.jpg', position: 0 })
    const detail = getDesignDetail(db, id)
    expect(detail?.pieces).toHaveLength(1)
    expect(detail?.pieces[0].photos).toHaveLength(1)
    expect(detail?.pieces[0].status).toBe('cataloged')
  })

  it('returns null detail for a missing design', () => {
    expect(getDesignDetail(db, 12345)).toBeNull()
  })

  it('resolves photo paths and misses cleanly', () => {
    const id = createDesign(db, { family: 'bowl', name: 'Animal Bowl' })
    const pieceId = addPiece(db, { design_id: id, colorway: 'natural', height_in: 2, width_in: 4, depth_in: 4, weight_lb: 1 })
    const photoId = addPhoto(db, { piece_id: pieceId, file_path: 'data/photos/1/0.jpg', position: 0 })
    expect(getPhotoPath(db, photoId)).toBe('data/photos/1/0.jpg')
    expect(getPhotoPath(db, 999)).toBeNull()
  })

  it('appends events for every mutation', () => {
    const id = createDesign(db, { family: 'love knot', name: 'Eternity Love Knot' })
    const pieceId = addPiece(db, { design_id: id, colorway: 'gray', height_in: 5, width_in: 3, depth_in: 3, weight_lb: 2 })
    addPhoto(db, { piece_id: pieceId, file_path: 'x.jpg', position: 0 })
    const types = listEvents(db).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['design.created', 'piece.added', 'photo.added']))
    const created = listEvents(db).find((e) => e.type === 'design.created')!
    expect(JSON.parse(created.payload)).toMatchObject({ name: 'Eternity Love Knot' })
  })

  it('links an etsy listing id to a design', () => {
    const id = createDesign(db, { family: 'coaster set', name: 'Etched Coaster Set' })
    setDesignEtsyListingId(db, id, 12345)
    expect(getDesignDetail(db, id)?.etsy_listing_id).toBe(12345)
    expect(listEvents(db).some((e) => e.type === 'etsy.listing_linked')).toBe(true)
  })

  it('marks all of a design pieces listed', () => {
    const id = createDesign(db, { family: 'coaster set', name: 'Set' })
    addPiece(db, { design_id: id, colorway: 'blue', height_in: 3, width_in: 4, depth_in: 4, weight_lb: 3 })
    addPiece(db, { design_id: id, colorway: 'red', height_in: 3, width_in: 4, depth_in: 4, weight_lb: 3 })
    markDesignPiecesListed(db, id)
    const detail = getDesignDetail(db, id)!
    expect(detail.pieces.every((p) => p.status === 'listed')).toBe(true)
  })

  it('records when a design was published by hand', () => {
    const id = createDesign(db, { family: 'figure', name: 'Lovers Loop' })
    expect(getDesignDetail(db, id)?.published_at).toBeNull()
    markDesignPublished(db, id)
    expect(getDesignDetail(db, id)?.published_at).toBeTruthy()
    expect(listEvents(db).some((e) => e.type === 'etsy.published')).toBe(true)
  })
})
