import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto, getDesignDetail, listEvents } from '@/lib/catalog/catalog'
import { createDraft, approveDraft } from '@/lib/catalog/drafts'
import { addVideo } from '@/lib/catalog/videos'
import { buildInventoryProducts, pushDraftToEtsy } from '@/lib/etsy/push'
import { EtsyApiError, type EtsyGateway } from '@/lib/etsy/gateway'

const DRAFT = {
  title: 'Vintage Kenyan Soapstone Coaster Set',
  description: 'd',
  tags: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12', 't13'],
  price_usd: 58,
  materials: ['soapstone'],
  colorway_notes: 'blue',
}

function fakeGateway(overrides: Partial<EtsyGateway> = {}): EtsyGateway {
  return {
    getMe: vi.fn(async () => ({ user_id: 1, shop_id: 42 })),
    getShippingProfiles: vi.fn(async () => [{ shipping_profile_id: 5, title: 'Manual' }]),
    getReadinessStateDefinitions: vi.fn(async () => [{ readiness_state_id: 3, readiness_state: 'ready_to_ship' }]),
    getSellerTaxonomyNodes: vi.fn(async () => [
      {
        id: 1,
        name: 'Home & Living',
        children: [
          { id: 3, name: 'Coasters', children: [] },
          { id: 1003, name: 'Decorative Bowls', children: [] },
        ],
      },
    ]),
    createDraftListing: vi.fn(async () => ({ listing_id: 777, state: 'draft', title: 't' })),
    deleteListing: vi.fn(async () => undefined),
    updateListing: vi.fn(async () => undefined),
    uploadListingImage: vi.fn(async () => undefined),
    uploadListingVideo: vi.fn(async () => undefined),
    updateListingInventory: vi.fn(async () => undefined),
    getPropertiesByTaxonomyId: vi.fn(async () => [
      { property_id: 505, name: 'Height', scales: [{ scale_id: 347, display_name: 'Inches' }], possible_values: [] },
      { property_id: 512, name: 'Width', scales: [{ scale_id: 338, display_name: 'Inches' }], possible_values: [] },
      { property_id: 513, name: 'Depth', scales: [{ scale_id: 344, display_name: 'Inches' }], possible_values: [] },
      { property_id: 200, name: 'Material multi', scales: [], possible_values: [{ value_id: 900, name: 'Soapstone' }] },
      { property_id: 201, name: 'Primary color', scales: [], possible_values: [{ value_id: 2, name: 'Blue' }] },
    ]),
    updateListingProperty: vi.fn(async () => undefined),

    ...overrides,
  }
}

async function seed(
  db: Db,
  dataDir: string,
  opts: {
    colorways: string[]
    approved?: boolean
    family?: string
    dims?: { height_in: number; width_in: number; depth_in: number }
  }
) {
  const designId = createDesign(db, { family: opts.family ?? 'coaster set', name: 'Etched Coaster Set' })
  const d = opts.dims ?? { height_in: 3, width_in: 4.5, depth_in: 4.5 }
  for (const [i, colorway] of opts.colorways.entries()) {
    const pieceId = addPiece(db, { design_id: designId, colorway, ...d, weight_lb: 3, quantity: 1 })
    const photoDir = path.join(dataDir, 'photos', String(pieceId))
    await mkdir(photoDir, { recursive: true })
    const file = path.join(photoDir, '0.jpg')
    await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: 10, g: 10, b: 200 } } }).jpeg().toFile(file)
    addPhoto(db, { piece_id: pieceId, file_path: file, position: i })
  }
  const draftId = createDraft(db, { design_id: designId, generated_json: JSON.stringify(DRAFT), model: 'm' })
  if (opts.approved !== false) approveDraft(db, { draft_id: draftId, final_json: JSON.stringify(DRAFT), edited_fields: [] })
  return designId
}

function setup() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'kemuma-push-'))
  const db = openDb(path.join(dataDir, 'catalog.sqlite'))
  return { db, dataDir }
}

describe('parcel dimensions', () => {
  // Live-confirmed 2026-07-24: Etsy rejects a create whose item_length is not the
  // longest side with shipping_profile_no_domestic_option. Tall carvings (6in high,
  // 2in deep) tripped it; flat coaster sets never did, which hid the bug.
  it('sends item_length as the longest side for a tall piece', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, {
      colorways: ['brown'],
      dims: { height_in: 6, width_in: 2.5, depth_in: 2 },
    })
    const gw = fakeGateway()
    await pushDraftToEtsy(db, gw, designId, dataDir)
    const input = (gw.createDraftListing as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(input.item_length).toBe(6)
    expect(input.item_width).toBe(2.5)
    expect(input.item_height).toBe(2)
    expect(input.item_length).toBeGreaterThanOrEqual(input.item_width)
    expect(input.item_width).toBeGreaterThanOrEqual(input.item_height)
  })

  it('keeps the longest side as length on update too', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, {
      colorways: ['brown'],
      dims: { height_in: 8, width_in: 3, depth_in: 2 },
    })
    const gw = fakeGateway()
    await pushDraftToEtsy(db, gw, designId, dataDir)
    await pushDraftToEtsy(db, gw, designId, dataDir)
    const patch = (gw.updateListing as ReturnType<typeof vi.fn>).mock.calls[0][2]
    expect(patch.item_length).toBe(8)
    expect(patch.item_height).toBe(2)
  })
})

describe('buildInventoryProducts', () => {
  it('builds one product per colorway with the shared price and readiness state', () => {
    const body = buildInventoryProducts([{ colorway: 'blue', quantity: 1 }, { colorway: 'rose', quantity: 2 }], 58, 3)
    expect(body.products).toHaveLength(2)
    expect(body.products[0].property_values[0]).toEqual({ property_id: 513, property_name: 'Colorway', values: ['blue'] })
    expect(body.products[1].offerings[0]).toEqual({ price: 58, quantity: 2, is_enabled: true, readiness_state_id: 3 })
  })

  it('declares the colorway property when stock counts differ', () => {
    // Etsy rejects the push with "quantity must be consistent across all
    // products" unless the property the count varies on is named.
    const body = buildInventoryProducts([{ colorway: 'maroon', quantity: 1 }, { colorway: 'assorted', quantity: 4 }], 58, 3)
    expect(body.quantity_on_property).toEqual([513])
  })

  it('leaves the property off when every colorway holds the same count', () => {
    const body = buildInventoryProducts([{ colorway: 'blue', quantity: 2 }, { colorway: 'rose', quantity: 2 }], 58, 3)
    expect(body.quantity_on_property).toBeUndefined()
  })
})

describe('pushDraftToEtsy', () => {
  it('creates a listing, uploads images, links the id, marks pieces listed', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    const gw = fakeGateway()
    const result = await pushDraftToEtsy(db, gw, designId, dataDir)
    expect(result.created).toBe(true)
    expect(result.listing_id).toBe(777)
    expect(result.images_uploaded).toBe(1)
    expect(result.taxonomy_name).toBe('Coasters')
    expect(gw.createDraftListing).toHaveBeenCalledOnce()
    const input = (gw.createDraftListing as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(input.when_made).toBe('1990s')
    expect(input.tags).toBe(DRAFT.tags.join(','))
    expect(getDesignDetail(db, designId)?.etsy_listing_id).toBe(777)
    expect(getDesignDetail(db, designId)?.pieces.every((p) => p.status === 'listed')).toBe(true)
    expect(listEvents(db).some((e) => e.type === 'etsy.pushed')).toBe(true)
  })

  it('sets variations for multi-colorway designs and survives inventory failure', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue', 'rose'] })
    const ok = await pushDraftToEtsy(db, fakeGateway(), designId, dataDir)
    expect(ok.variations_set).toBe(true)

    const { db: db2, dataDir: dir2 } = setup()
    const design2 = await seed(db2, dir2, { colorways: ['blue', 'rose'] })
    const failing = fakeGateway({
      updateListingInventory: vi.fn(async () => {
        const { EtsyApiError } = await import('@/lib/etsy/gateway')
        throw new EtsyApiError(400, '{"error":"invalid property"}')
      }),
    })
    const failed = await pushDraftToEtsy(db2, failing, design2, dir2)
    expect(failed.variations_set).toBe(false)
    expect(failed.created).toBe(true)
    expect(failed.warnings.join(' ')).toMatch(/invalid property/)
  })

  it('persists warnings and when the push produced them', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue', 'rose'] })
    const gw = fakeGateway({
      updateListingInventory: vi.fn(async () => {
        throw new Error('quantity must be consistent across all products')
      }),
    })

    const result = await pushDraftToEtsy(db, gw, designId, dataDir)
    const stored = db
      .prepare('SELECT push_warnings_json, push_warned_at FROM designs WHERE design_id = ?')
      .get(designId) as { push_warnings_json: string | null; push_warned_at: string | null }

    expect(JSON.parse(stored.push_warnings_json!)).toEqual(result.warnings)
    expect(stored.push_warned_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('clears stale warning state when a push has no warnings', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    db.prepare(
      'UPDATE designs SET push_warnings_json = ?, push_warned_at = ? WHERE design_id = ?'
    ).run('["old failure"]', '2026-01-01T00:00:00.000Z', designId)

    const result = await pushDraftToEtsy(db, fakeGateway(), designId, dataDir)
    const stored = db
      .prepare('SELECT push_warnings_json, push_warned_at FROM designs WHERE design_id = ?')
      .get(designId) as { push_warnings_json: string | null; push_warned_at: string | null }

    expect(result.warnings).toEqual([])
    expect(stored).toEqual({ push_warnings_json: null, push_warned_at: null })
  })

  it('updates instead of recreating when a listing id exists', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    const gw = fakeGateway()
    await pushDraftToEtsy(db, gw, designId, dataDir)
    const again = await pushDraftToEtsy(db, gw, designId, dataDir)
    expect(again.created).toBe(false)
    expect(gw.createDraftListing).toHaveBeenCalledOnce()
    expect(gw.updateListing).toHaveBeenCalledOnce()
  })

  it('warns when measurements are estimated', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    db.prepare('UPDATE designs SET notes = ? WHERE design_id = ?').run('dims ESTIMATED from photos', designId)
    const result = await pushDraftToEtsy(db, fakeGateway(), designId, dataDir)
    expect(result.warnings.join(' ')).toMatch(/estimated/i)
  })

  it('sends a fraction of a pound as whole ounces, rounded up', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    // 0.4 lb is 6.4 oz. Rounding down would understate the parcel.
    db.prepare('UPDATE pieces SET weight_lb = 0.4 WHERE design_id = ?').run(designId)
    const gw = fakeGateway()
    await pushDraftToEtsy(db, gw, designId, dataDir)
    const body = (gw.createDraftListing as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(body.item_weight).toBe(7)
    expect(body.item_weight_unit).toBe('oz')
  })

  it('leaves a whole number of pounds in pounds', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    const gw = fakeGateway()
    await pushDraftToEtsy(db, gw, designId, dataDir)
    const body = (gw.createDraftListing as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(body.item_weight).toBe(3)
    expect(body.item_weight_unit).toBe('lb')
  })

  it('sends one video, then never sends it again', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    const pieceId = getDesignDetail(db, designId)!.pieces[0].piece_id
    const clip = path.join(dataDir, 'turn.mov')
    await writeFile(clip, Buffer.from('movbytes'))
    addVideo(db, { piece_id: pieceId, file_path: clip })

    const gw = fakeGateway()
    const first = await pushDraftToEtsy(db, gw, designId, dataDir)
    expect(first.video_uploaded).toBe(true)
    expect(gw.uploadListingVideo).toHaveBeenCalledOnce()

    // Etsy keeps one video per listing, so a re-push must not spend the upload
    // replacing the clip with itself.
    const second = await pushDraftToEtsy(db, gw, designId, dataDir)
    expect(second.video_uploaded).toBe(false)
    expect(gw.uploadListingVideo).toHaveBeenCalledOnce()
  })

  it('pushes fine when the design was never filmed', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    const gw = fakeGateway()
    const result = await pushDraftToEtsy(db, gw, designId, dataDir)
    expect(result.video_uploaded).toBe(false)
    expect(gw.uploadListingVideo).not.toHaveBeenCalled()
    expect(result.warnings).toEqual([])
  })

  it('warns rather than failing the push when the video upload breaks', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    const pieceId = getDesignDetail(db, designId)!.pieces[0].piece_id
    const clip = path.join(dataDir, 'turn.mov')
    await writeFile(clip, Buffer.from('movbytes'))
    addVideo(db, { piece_id: pieceId, file_path: clip })

    const gw = fakeGateway({
      uploadListingVideo: vi.fn(async () => {
        throw new Error('video too long')
      }),
    })
    const result = await pushDraftToEtsy(db, gw, designId, dataDir)
    expect(result.listing_id).toBe(777)
    expect(result.video_uploaded).toBe(false)
    expect(result.warnings.join(' ')).toMatch(/video too long/)
  })

  it('refuses to push without an approved draft', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'], approved: false })
    await expect(pushDraftToEtsy(db, fakeGateway(), designId, dataDir)).rejects.toThrow(/approved/i)
  })

  it('writes dimension attributes so etsy highlights show them', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'], family: 'heart dish' })
    const gw = fakeGateway()
    const result = await pushDraftToEtsy(db, gw, designId, dataDir)
    expect(result.attributes_set).toBe(4)
    const calls = (gw.updateListingProperty as ReturnType<typeof vi.fn>).mock.calls
    // seed pieces: height 3, width 4.5, depth 4.5, weight 3
    expect(calls).toContainEqual([42, 777, 200, { values: 'Soapstone', value_ids: [900] }])
    expect(calls).toContainEqual([42, 777, 505, { values: '3', scale_id: 347 }])
    expect(calls).toContainEqual([42, 777, 512, { values: '4.5', scale_id: 338 }])
    expect(calls).toContainEqual([42, 777, 513, { values: '4.5', scale_id: 344 }])
  })

  it('skips missing attributes with a warning and keeps the rest', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'], family: 'heart dish' })
    const gw = fakeGateway({
      getPropertiesByTaxonomyId: vi.fn(async () => [
        { property_id: 512, name: 'Width', scales: [{ scale_id: 338, display_name: 'Inches' }], possible_values: [] },
      ]),
    })
    const result = await pushDraftToEtsy(db, gw, designId, dataDir)
    expect(result.attributes_set).toBe(1)
    expect(result.warnings.join(' ')).toMatch(/Height attribute/)
  })

  it('survives per-attribute failures', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'], family: 'heart dish' })
    const gw = fakeGateway({
      updateListingProperty: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const result = await pushDraftToEtsy(db, gw, designId, dataDir)
    expect(result.attributes_set).toBe(0)
    expect(result.created).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/boom/)
  })

  it('writes material, color, and dimension attributes from the draft and catalog', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'], family: 'heart dish' })
    // give the draft an AI-picked color
    const { latestDraftForDesign } = await import('@/lib/catalog/drafts')
    const rec = latestDraftForDesign(db, designId)!
    const final = { ...JSON.parse(rec.final_json!), primary_color: 'Blue' }
    const { approveDraft } = await import('@/lib/catalog/drafts')
    approveDraft(db, { draft_id: rec.draft_id, final_json: JSON.stringify(final), edited_fields: [] })

    const gw = fakeGateway()
    const result = await pushDraftToEtsy(db, gw, designId, dataDir)
    const calls = (gw.updateListingProperty as ReturnType<typeof vi.fn>).mock.calls
    // material Soapstone -> value_id 900 on property 200
    expect(calls).toContainEqual([42, 777, 200, { values: 'Soapstone', value_ids: [900] }])
    // primary color Blue -> value_id 2 on property 201
    expect(calls).toContainEqual([42, 777, 201, { values: 'Blue', value_ids: [2] }])
    // dimensions height 3 on property 505
    expect(calls).toContainEqual([42, 777, 505, { values: '3', scale_id: 347 }])
    expect(result.attributes_set).toBeGreaterThanOrEqual(3)
  })
})

/* Recorded in the catalogue on 2026-07-27 01:25:11: the Standing Giraffe listing
   went live with two of its four photos and this in the warnings.

     ["image 147 failed to upload: fetch failed",
      "image 149 failed to upload: fetch failed"]

   147 is position 0, the listing's lead shot. Two pushes ran in the next forty
   seconds and uploaded nothing, because the photo loop only runs when the
   listing is being created. So a dropped photo was not only un-retried, it was
   unreachable afterwards.

   The same reasoning as images-codex.ts: retry the transient thing, never retry
   a refusal that means something. */
describe('image uploads survive a dropped connection', () => {
  const transient = () => Object.assign(new TypeError('fetch failed'), { name: 'TypeError' })

  it('retries a transient upload failure instead of dropping the photo', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue', 'red'] })
    let attempts = 0
    const gw = fakeGateway({
      uploadListingImage: vi.fn(async () => {
        attempts += 1
        // Fails once for the first photo, as the live push did.
        if (attempts === 1) throw transient()
        return undefined
      }),
    })

    const result = await pushDraftToEtsy(db, gw, designId, dataDir, { backoffMs: 0 })
    expect(result.images_uploaded).toBe(2)
    expect(result.warnings).toEqual([])
  })

  it('does not retry a refusal that means something', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    const upload = vi.fn(async () => {
      throw new EtsyApiError(400, 'image is not a valid jpeg')
    })
    const gw = fakeGateway({ uploadListingImage: upload })

    const result = await pushDraftToEtsy(db, gw, designId, dataDir, { backoffMs: 0 })
    // One attempt. Etsy looked at the file and said no; asking twice more only
    // spends the shop's rate limit to hear the same answer.
    expect(upload).toHaveBeenCalledTimes(1)
    expect(result.images_uploaded).toBe(0)
    expect(result.warnings.join(' ')).toMatch(/not a valid jpeg/)
  })

  it('retries a rate limit, which is an instruction to wait rather than a refusal', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    let attempts = 0
    const gw = fakeGateway({
      uploadListingImage: vi.fn(async () => {
        attempts += 1
        if (attempts === 1) throw new EtsyApiError(429, 'rate limit exceeded')
        return undefined
      }),
    })

    const result = await pushDraftToEtsy(db, gw, designId, dataDir, { backoffMs: 0 })
    expect(result.images_uploaded).toBe(1)
    expect(result.warnings).toEqual([])
  })

  it('gives up after three attempts and says so, rather than failing silently', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'] })
    const upload = vi.fn(async () => {
      throw transient()
    })
    const gw = fakeGateway({ uploadListingImage: upload })

    const result = await pushDraftToEtsy(db, gw, designId, dataDir, { backoffMs: 0 })
    expect(upload).toHaveBeenCalledTimes(3)
    expect(result.images_uploaded).toBe(0)
    expect(result.warnings.join(' ')).toMatch(/failed to upload/)
  })
})
