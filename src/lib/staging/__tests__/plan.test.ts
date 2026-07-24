import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto } from '@/lib/catalog/catalog'
import { StagingPlanSchema, assemblePlanPrompt, validatePlan, type StagingPlan } from '@/lib/staging/plan'

function tempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-plan-')), 'catalog.sqlite')
}

const basePlan: StagingPlan = {
  scene:
    'Photorealistic editorial product photograph on a light ash dresser. A thin gold figaro chain drapes over the rim of the dish with a pair of silver earrings inside; both are jewelry props, clearly not carved stone.',
  lighting:
    "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination: soft warm window light from camera left, matching color temperature. Ground it with directionally consistent contact shadows on the dresser and a faint warm bounce onto its base.",
  subject_and_count:
    'Image 1 is the only product reference. Show exactly one carved canoe-shaped dish, appearing exactly once.',
  composition: 'The dish sits slightly left of center at realistic 8-inch length, three-quarter view, generous negative space.',
  product_lock:
    'Use the exact physical product from Image 1. Preserve the canoe silhouette, looped handle, etched panels, and maroon tones. Do not restyle, redraw, smooth, or symmetrize.',
  extra_exclusions: ['No additional dishes.'],
  size: '1536x1024',
  reference_photo_ids: [],
  n: 4,
}

describe('staging plans', () => {
  let db: Db
  let designId: number
  let photoId: number

  beforeEach(() => {
    db = openDb(tempDbPath())
    designId = createDesign(db, { family: 'trinket dish', name: 'Canoe Trinket Dish' })
    const pieceId = addPiece(db, {
      design_id: designId, colorway: 'maroon', height_in: 2, width_in: 8, depth_in: 3, weight_lb: 1.5,
    })
    photoId = addPhoto(db, { piece_id: pieceId, file_path: '/tmp/x.jpg', position: 0 })
  })

  it('parses a full plan and assembles the six sections in order', () => {
    const plan = StagingPlanSchema.parse({ ...basePlan, reference_photo_ids: [photoId] })
    const prompt = assemblePlanPrompt(plan)
    const order = ['SCENE - ', 'SUBJECT AND COUNT - ', 'COMPOSITION - ', 'LIGHTING AND INTEGRATION - ', 'PRODUCT LOCK - ', 'EXCLUSIONS - ']
      .map((l) => prompt.indexOf(l))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(prompt).toContain('gold figaro chain')
    expect(prompt).toContain('No duplicate product') // BASE_EXCLUSIONS always appended
  })

  it('accepts a valid plan against the design', () => {
    expect(validatePlan(db, designId, { ...basePlan, reference_photo_ids: [photoId] })).toEqual([])
  })

  it('rejects prompts missing mandatory phrases', () => {
    const errors = validatePlan(db, designId, {
      ...basePlan,
      reference_photo_ids: [photoId],
      lighting: 'Soft light from the left.',
    })
    expect(errors.join('; ')).toMatch(/never composited/)
  })

  it('rejects reference photos from another design and empty references', () => {
    const otherId = createDesign(db, { family: 'figure', name: 'Other' })
    const otherPiece = addPiece(db, {
      design_id: otherId, colorway: 'gray', height_in: 5, width_in: 2, depth_in: 2, weight_lb: 1,
    })
    const stranger = addPhoto(db, { piece_id: otherPiece, file_path: '/tmp/o.jpg', position: 0 })
    expect(validatePlan(db, designId, { ...basePlan, reference_photo_ids: [stranger] }).join('; ')).toMatch(
      /not photos of this design/
    )
    expect(validatePlan(db, designId, { ...basePlan, reference_photo_ids: [] }).join('; ')).toMatch(
      /at least one reference photo/
    )
  })
})
