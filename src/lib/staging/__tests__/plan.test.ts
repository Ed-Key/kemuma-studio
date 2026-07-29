import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto } from '@/lib/catalog/catalog'
import {
  StagingPlanSchema,
  assemblePlanPrompt,
  countSentence,
  parsePendingPlan,
  parseStoredPlan,
  validatePlan,
  type StagingPlan,
} from '@/lib/staging/plan'

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

  it('refuses a count whose what is only whitespace', () => {
    expect(StagingPlanSchema.shape.counts.safeParse([{ n: 1, what: '   ' }]).success).toBe(false)
  })

  /* The written-out numbers and the counts they can contradict have to cover
     the same range or the rule has a hole above it: n was unbounded while the
     words stopped at twenty, so {n: 21, what: "twenty-one coasters"} passed and
     assembled as "exactly 21 twenty-one coasters". These are soapstone sets,
     not warehouse stock, so the cap is the honest fix. */
  it('refuses a count larger than the words that could contradict it', () => {
    const parse = (n: number) =>
      StagingPlanSchema.shape.counts.safeParse([{ n, what: 'coasters' }]).success
    expect(parse(20)).toBe(true)
    expect(parse(21)).toBe(false)
    expect(parse(100)).toBe(false)
  })

  /* The refinement on `what` exists to stop the model writing the count into
     the noun ("exactly one cat figure"), which made the assembler double it.
     A false rejection here would start the same loop the field replaced, so
     the boundary is worth pinning: a leading number followed by a space is a
     count, a leading number followed by a hyphen is a dimension. */
  describe('the noun phrase a count carries', () => {
    const parse = (n: number, what: string) =>
      StagingPlanSchema.shape.counts.safeParse([{ n, what }]).success

    it.each([
      { n: 1, what: 'soapstone holder' },
      { n: 1, what: 'coasters' },
      { n: 1, what: '6-inch base' },
      { n: 1, what: '2-piece set' },
      { n: 1, what: '12-sided die' },
      { n: 1, what: 'figure-of-eight knot' },
      { n: 1, what: 'three-legged stool' },
      { n: 1, what: 'onesie' },
      { n: 1, what: 'anemone' },
      { n: 1, what: 'oneida bowl' },
      { n: 1, what: 'Three Wise Monkeys figure' },
      { n: 5, what: 'two figures' },
    ])('accepts $what with n=$n', ({ n, what }) => expect(parse(n, what)).toBe(true))

    it.each([
      { n: 1, what: 'a dish' },
      { n: 1, what: 'an urn' },
      { n: 1, what: 'one cat' },
      { n: 2, what: 'two figures' },
      { n: 6, what: '6 coasters' },
      { n: 1, what: 'exactly one cat' },
      { n: 8, what: 'eight coasters' },
      { n: 13, what: 'thirteen coasters' },
      { n: 20, what: 'twenty coasters' },
    ])('refuses $what with n=$n', ({ n, what }) => expect(parse(n, what)).toBe(false))
  })

  /* "Show exactly 6 coasters, appearing exactly once" reads as though the six
     of them turn up once between them, which is the ambiguity this whole field
     exists to remove. The singular was picked from the number of entries in the
     list rather than the number of objects the list describes. */
  describe('the count sentence', () => {
    it('says each when one entry counts several objects', () => {
      expect(countSentence([{ n: 6, what: 'coasters' }])).toMatch(/each appearing exactly once/)
    })

    it('stays singular when the plan describes a single object', () => {
      expect(countSentence([{ n: 1, what: 'dish' }])).toBe(
        'Image 1 is the only product reference. Show exactly 1 dish, appearing exactly once.'
      )
    })

    it('joins two entries with and', () => {
      expect(countSentence([{ n: 1, what: 'holder' }, { n: 6, what: 'coasters' }])).toContain(
        'exactly 1 holder and exactly 6 coasters'
      )
    })

    it('joins three entries with commas and a final and', () => {
      expect(
        countSentence([{ n: 1, what: 'holder' }, { n: 6, what: 'coasters' }, { n: 2, what: 'feet' }])
      ).toContain('exactly 1 holder, exactly 6 coasters and exactly 2 feet')
    })
  })

  /* A plan written before counts replaced subject_and_count still sits in
     staging_chats on the live catalogue. It renders fine, because the card only
     reads scene and n, and then Generate throws a raw Zod error at the owner.
     Nothing can recover the counts from that prose without guessing, which is
     the guessing this change removed, so the plan has to be retired out loud. */
  describe('a pending plan written against the old shape', () => {
    const legacy = JSON.stringify({
      scene: 'On a dresser.',
      lighting: 'Warm window light from the left.',
      subject_and_count: 'Show exactly one dish, appearing exactly once.',
      composition: 'Centred at 8 inches.',
      product_lock: 'Banded rim.',
      extra_exclusions: [],
      size: '1536x1024',
      reference_photo_ids: [1],
      n: 4,
    })

    it('is reported as stale rather than thrown at the owner', () => {
      const result = parsePendingPlan(legacy)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toMatch(/plan again|re-?plan|ask the (staging )?director/i)
      expect(result.reason).not.toMatch(/zod|invalid_type|undefined/i)
    })

    it('still accepts a plan written against the current shape', () => {
      const result = parsePendingPlan(JSON.stringify({ ...basePlan, reference_photo_ids: [photoId] }))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.plan.counts).toEqual([{ n: 1, what: 'carved canoe-shaped dish' }])
    })

    it('reports unparseable json as stale too, rather than throwing', () => {
      expect(parsePendingPlan('{not json').ok).toBe(false)
    })

    /* The chat is not the only place a plan is stored. A planned_batch job keeps
       its own copy in input_json so the batch can be run again after an
       interruption, and ten of those in the catalogue hold the old shape. That
       replay has to give the owner the same sentence, not a Zod dump. */
    it('gives the same answer for a plan replayed from a job row', () => {
      const result = parseStoredPlan(JSON.parse(legacy))
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toMatch(/plan again/i)
    })

    it('accepts a current plan replayed from a job row', () => {
      expect(parseStoredPlan({ ...basePlan, reference_photo_ids: [photoId] }).ok).toBe(true)
    })
  })
})
