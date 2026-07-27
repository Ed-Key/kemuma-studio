import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'
import { addPhoto, addPiece, createDesign } from '@/lib/catalog/catalog'
import { createStagedImage, approveStagedImage, rejectStagedImage } from '@/lib/catalog/staged'
import { rankScenesForFamily } from '@/lib/staging/pick-scene'

describe('rankScenesForFamily', () => {
  let db: Db
  let designId: number
  let photoId: number

  beforeEach(() => {
    db = openDb(path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-pick-')), 'catalog.sqlite'))
    designId = createDesign(db, { family: 'coaster set', name: 'Etched Coaster Set' })
    const pieceId = addPiece(db, {
      design_id: designId, colorway: 'blue', height_in: 3, width_in: 4.5, depth_in: 4.5, weight_lb: 3,
    })
    photoId = addPhoto(db, { piece_id: pieceId, file_path: '/tmp/a.jpg', position: 0 })
  })

  function history(scene: string, approved: number, rejected: number) {
    for (let i = 0; i < approved + rejected; i++) {
      const id = createStagedImage(db, {
        design_id: designId, scene_key: scene, source_photo_id: photoId,
        prompt: 'p', file_path: `/tmp/${scene}-${i}.png`, model: 'm', cost_usd: 0.21,
      })
      if (i < approved) approveStagedImage(db, { staged_id: id, destination: 'social' })
      else rejectStagedImage(db, id, 'looks_fake')
    }
  }

  it('spends on the scene with the best measured yield for this family', () => {
    history('bar-cart', 15, 3)
    history('book-stack', 6, 13)
    expect(rankScenesForFamily(db, designId, 'coaster set')[0]).toBe('bar-cart')
  })

  it('does not let another family\'s record vote', () => {
    // color-seamless runs 6 of 8 on sculpture and 4 of 12 on coaster sets in
    // the real catalogue. Pooling those describes neither product.
    const figure = createDesign(db, { family: 'figure', name: 'Lovers Loop' })
    const figurePiece = addPiece(db, {
      design_id: figure, colorway: 'brown', height_in: 6, width_in: 2.5, depth_in: 2, weight_lb: 1,
    })
    const figurePhoto = addPhoto(db, { piece_id: figurePiece, file_path: '/tmp/f.jpg', position: 0 })
    for (let i = 0; i < 12; i++) {
      const id = createStagedImage(db, {
        design_id: figure, scene_key: 'color-seamless', source_photo_id: figurePhoto,
        prompt: 'p', file_path: `/tmp/cs-${i}.png`, model: 'm', cost_usd: 0.21,
      })
      approveStagedImage(db, { staged_id: id, destination: 'social' })
    }
    history('bar-cart', 9, 1)
    expect(rankScenesForFamily(db, designId, 'coaster set')[0]).toBe('bar-cart')
  })

  it('ignores a rate built on too few judgements', () => {
    // 2 of 2 is not an 83% scene, it is two lucky images. Anything under the
    // threshold falls back to least-used rather than crowning a fluke.
    history('book-stack', 2, 0)
    const picked = rankScenesForFamily(db, designId, 'coaster set')[0]
    expect(picked).not.toBe('book-stack')
  })

  it('falls back to the least-used scene before any history exists', () => {
    const picked = rankScenesForFamily(db, designId, 'coaster set')[0]
    expect(typeof picked).toBe('string')
    expect(picked.length).toBeGreaterThan(0)
  })

  /* A capture fires two batches off this ranking, so what matters is that the
     second entry is a different scene from the first. Two batches on one scene
     would buy the same failure twice. */
  it('orders every scene for the family without repeating one', () => {
    history('bar-cart', 15, 3)
    history('book-stack', 6, 13)
    const ranked = rankScenesForFamily(db, designId, 'coaster set')

    expect(ranked.length).toBeGreaterThan(1)
    expect(new Set(ranked).size).toBe(ranked.length)
    expect(ranked[0]).toBe('bar-cart')
    expect(ranked[1]).not.toBe('bar-cart')
  })

})
