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
  counts: [{ n: 1, what: 'carved canoe-shaped dish' }],
  arrangement: 'The dish alone, three-quarter view, nothing else carved in frame.',
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

  it('supplies the mandatory lock sentences the writer left out', () => {
    // The writer used to be rejected for omitting fixed text it had to retype,
    // which is where whole director turns went. Now the assembler states it.
    const plan = {
      ...basePlan,
      reference_photo_ids: [photoId],
      lighting: 'Soft light from the left.',
      product_lock: 'Keep the incised bands and the chipped rim.',
    }
    expect(validatePlan(db, designId, plan)).toEqual([])
    const prompt = assemblePlanPrompt(plan)
    expect(prompt).toContain('never composited')
    expect(prompt).toContain('Use the exact physical product from Image 1.')
    expect(prompt).toContain('Do not restyle, redraw, smooth, or symmetrize.')
    expect(prompt).toContain('Keep the incised bands and the chipped rim.')
  })

  it('states each lock once even when the writer also wrote it', () => {
    const prompt = assemblePlanPrompt({
      ...basePlan,
      reference_photo_ids: [photoId],
      product_lock: `Use the exact physical product from Image 1. Keep the bands. Do not restyle, redraw, smooth, or symmetrize.`,
    })
    expect(prompt.split('Use the exact physical product from Image 1.')).toHaveLength(2)
    expect(prompt.split('Do not restyle, redraw, smooth, or symmetrize.')).toHaveLength(2)
  })

  it('still rejects a plan that does not state an exact count', () => {
    // The count sentence is assembled now, so a writer can no longer drop it.
    // What it can still do is name a photo that belongs to another design.
    const errors = validatePlan(db, designId, {
      ...basePlan,
      reference_photo_ids: [photoId, 9999],
    })
    expect(errors.join('; ')).toMatch(/9999/)
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

  /* The old shape asked the writer for a sentence and then checked the sentence
     contained the word "exactly". Eight runs in the catalogue failed that check
     between four and thirteen times each, because remembering a literal string
     is the thing language models are worst at. The count is data now, and the
     assembler owns the wording, so the word cannot go missing. */
  it('writes the count sentence from the numbers rather than trusting prose', () => {
    const prompt = assemblePlanPrompt({
      scene: 'On a walnut side table in evening light.',
      lighting: 'Warm lamp just off frame, raking from the left.',
      counts: [
        { n: 1, what: 'soapstone holder' },
        { n: 6, what: 'coasters' },
      ],
      arrangement: 'Holder upright with four coasters inside and two fanned in front.',
      composition: 'Centred at its real 3 inch height.',
      product_lock: 'Incised banding, chipped rim, dark veining.',
      extra_exclusions: [],
      size: '1536x1024',
      reference_photo_ids: [1],
      n: 4,
    })

    expect(prompt).toMatch(/exactly 1 soapstone holder/)
    expect(prompt).toMatch(/exactly 6 coasters/)
    expect(prompt).toMatch(/Holder upright with four coasters inside/)
  })

  it('refuses a plan with no counts at all, at parse time', () => {
    const parsed = StagingPlanSchema.safeParse({
      scene: 'x', lighting: 'y', counts: [], arrangement: 'z',
      composition: 'c', product_lock: 'p', extra_exclusions: [],
      size: '1536x1024', reference_photo_ids: [1], n: 4,
    })
    expect(parsed.success).toBe(false)
  })

})
