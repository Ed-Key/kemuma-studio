import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign, addPiece, addPhoto, getDesignDetail, listEvents } from '@/lib/catalog/catalog'
import { createDraft, approveDraft } from '@/lib/catalog/drafts'
import { buildInventoryProducts, pushDraftToEtsy } from '@/lib/etsy/push'
import type { EtsyGateway } from '@/lib/etsy/gateway'

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
      { id: 1, name: 'Home & Living', children: [{ id: 3, name: 'Coasters', children: [] }] },
    ]),
    createDraftListing: vi.fn(async () => ({ listing_id: 777, state: 'draft', title: 't' })),
    deleteListing: vi.fn(async () => undefined),
    updateListing: vi.fn(async () => undefined),
    uploadListingImage: vi.fn(async () => undefined),
    updateListingInventory: vi.fn(async () => undefined),
    ...overrides,
  }
}

async function seed(db: Db, dataDir: string, opts: { colorways: string[]; approved?: boolean }) {
  const designId = createDesign(db, { family: 'coaster set', name: 'Etched Coaster Set' })
  for (const [i, colorway] of opts.colorways.entries()) {
    const pieceId = addPiece(db, { design_id: designId, colorway, height_in: 3, width_in: 4.5, depth_in: 4.5, weight_lb: 3, quantity: 1 })
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

describe('buildInventoryProducts', () => {
  it('builds one product per colorway with the shared price', () => {
    const body = buildInventoryProducts([{ colorway: 'blue', quantity: 1 }, { colorway: 'rose', quantity: 2 }], 58)
    expect(body.products).toHaveLength(2)
    expect(body.products[0].property_values[0]).toEqual({ property_id: 513, property_name: 'Colorway', values: ['blue'] })
    expect(body.products[1].offerings[0]).toEqual({ price: 58, quantity: 2, is_enabled: true })
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

  it('refuses to push without an approved draft', async () => {
    const { db, dataDir } = setup()
    const designId = await seed(db, dataDir, { colorways: ['blue'], approved: false })
    await expect(pushDraftToEtsy(db, fakeGateway(), designId, dataDir)).rejects.toThrow(/approved/i)
  })
})
