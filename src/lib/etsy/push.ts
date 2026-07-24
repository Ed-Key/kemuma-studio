import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Db } from '@/lib/catalog/db'
import {
  getDesignDetail,
  getPhotoPath,
  logEvent,
  markDesignPiecesListed,
  setDesignEtsyListingId,
} from '@/lib/catalog/catalog'
import { latestDraftForDesign } from '@/lib/catalog/drafts'
import { prepareImage, PREPARED_MAX_EDGE, PREPARED_QUALITY } from '@/lib/images/prepare'
import type { EtsyGateway } from './gateway'
import { EtsyApiError } from './gateway'
import type { InventoryBody } from './types'
import { pickTaxonomyNode } from './taxonomy'

export interface PushResult {
  listing_id: number
  created: boolean
  images_uploaded: number
  variations_set: boolean
  attributes_set: number
  taxonomy_name: string | null
  warnings: string[]
}

export function buildInventoryProducts(
  pieces: Array<{ colorway: string; quantity: number }>,
  price: number,
  readinessStateId: number
): InventoryBody {
  return {
    products: pieces.map((p) => ({
      property_values: [{ property_id: 513, property_name: 'Colorway', values: [p.colorway] }],
      // Live-API discovery 2026-07-24: etsy rejects offerings without a
      // readiness state ("All offerings need readiness state").
      offerings: [{ price, quantity: p.quantity, is_enabled: true, readiness_state_id: readinessStateId }],
    })),
  }
}

export async function pushDraftToEtsy(
  db: Db,
  gateway: EtsyGateway,
  designId: number,
  dataDir: string
): Promise<PushResult> {
  const detail = getDesignDetail(db, designId)
  if (!detail) throw new Error(`design ${designId} not found`)
  const record = latestDraftForDesign(db, designId)
  if (!record || record.status !== 'approved' || !record.final_json) {
    throw new Error('design has no approved draft; approve one in the review screen first')
  }
  const draft = JSON.parse(record.final_json) as {
    title: string
    description: string
    tags: string[]
    price_usd: number
    materials: string[]
  }

  const warnings: string[] = []
  if (/estimated/i.test(detail.notes ?? '')) {
    warnings.push('measurements are estimated; verify with a tape measure and scale before publishing')
  }

  const quantity = detail.pieces.reduce((sum, p) => sum + p.quantity, 0)
  const weight = Math.max(...detail.pieces.map((p) => p.weight_lb))
  const height = Math.max(...detail.pieces.map((p) => p.height_in))
  const width = Math.max(...detail.pieces.map((p) => p.width_in))
  const depth = Math.max(...detail.pieces.map((p) => p.depth_in))

  const me = await gateway.getMe()
  const profiles = await gateway.getShippingProfiles(me.shop_id)
  if (profiles.length === 0) throw new Error('no shipping profiles on the shop')
  const readiness = await gateway.getReadinessStateDefinitions(me.shop_id)
  if (readiness.length === 0) throw new Error('no readiness state definitions on the shop')
  const taxonomy = await gateway.getSellerTaxonomyNodes()
  const node = pickTaxonomyNode(taxonomy, detail.family)
  const taxonomyId = node?.id ?? pickTaxonomyNode(taxonomy, 'sculpture')?.id
  if (!taxonomyId) throw new Error('could not pick a taxonomy node')

  let listingId = detail.etsy_listing_id
  let created = false
  let imagesUploaded = 0
  let variationsSet = false

  if (listingId == null) {
    const listing = await gateway.createDraftListing(me.shop_id, {
      quantity,
      title: draft.title,
      description: draft.description,
      price: draft.price_usd,
      who_made: 'someone_else',
      when_made: '1990s',
      taxonomy_id: taxonomyId,
      shipping_profile_id: profiles[0].shipping_profile_id,
      readiness_state_id: readiness[0].readiness_state_id,
      item_weight: weight,
      item_weight_unit: 'lb',
      item_length: depth,
      item_width: width,
      item_height: height,
      item_dimensions_unit: 'in',
      tags: draft.tags.join(','),
      materials: draft.materials.join(','),
    })
    listingId = listing.listing_id
    created = true
    setDesignEtsyListingId(db, designId, listingId)

    const photos = detail.pieces
      .flatMap((p) => p.photos.map((ph) => ({ piece_id: p.piece_id, photo_id: ph.photo_id, position: ph.position })))
      .slice(0, 10)
    for (const [index, photo] of photos.entries()) {
      try {
        const src = getPhotoPath(db, photo.photo_id)
        if (!src) continue
        const prepared = path.join(dataDir, 'prepared', String(photo.piece_id), `${photo.position}.jpg`)
        await prepareImage(src, prepared, { maxEdge: PREPARED_MAX_EDGE, quality: PREPARED_QUALITY })
        await gateway.uploadListingImage(me.shop_id, listingId, await readFile(prepared), path.basename(prepared), index + 1)
        imagesUploaded += 1
      } catch (err) {
        warnings.push(`image ${photo.photo_id} failed to upload: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

  } else {
    await gateway.updateListing(me.shop_id, listingId, {
      title: draft.title,
      description: draft.description,
      tags: draft.tags.join(','),
      materials: draft.materials.join(','),
      price: draft.price_usd,
      item_weight: weight,
      item_weight_unit: 'lb',
      item_length: depth,
      item_width: width,
      item_height: height,
      item_dimensions_unit: 'in',
    })
    warnings.push('update mode: images not re-pushed')
  }

  // Etsy's listing-page Highlights read structured attributes, not the
  // description or shipping fields (Ed noticed dimensions missing there,
  // 2026-07-24). Resolve properties by name from the live taxonomy so this
  // works across families with different property sets.
  let attributesSet = 0
  try {
    const props = await gateway.getPropertiesByTaxonomyId(taxonomyId)
    const wanted: Array<{ name: string; value: number; scaleName: string }> = [
      { name: 'Height', value: height, scaleName: 'Inches' },
      { name: 'Width', value: width, scaleName: 'Inches' },
      { name: 'Length', value: depth, scaleName: 'Inches' },
      { name: 'Weight', value: weight, scaleName: 'Pounds' },
    ]
    for (const attr of wanted) {
      const prop = props.find((p) => p.name === attr.name)
      const scale = prop?.scales.find((s) => s.display_name === attr.scaleName)
      if (!prop || !scale) {
        warnings.push(`no ${attr.name} attribute in this category; skipped`)
        continue
      }
      try {
        await gateway.updateListingProperty(me.shop_id, listingId, prop.property_id, {
          values: String(attr.value),
          scale_id: scale.scale_id,
        })
        attributesSet += 1
      } catch (err) {
        warnings.push(`${attr.name} attribute failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    warnings.push(`could not load category attributes: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Variations run for both create and update so the discovery loop can
  // retry them on an existing listing (the inventory PUT is idempotent).
  const colorways = new Map<string, number>()
  for (const p of detail.pieces) colorways.set(p.colorway, (colorways.get(p.colorway) ?? 0) + p.quantity)
  if (colorways.size >= 2) {
    try {
      await gateway.updateListingInventory(
        listingId,
        buildInventoryProducts(
          Array.from(colorways, ([colorway, qty]) => ({ colorway, quantity: qty })),
          draft.price_usd,
          readiness[0].readiness_state_id
        )
      )
      variationsSet = true
    } catch (err) {
      const body = err instanceof EtsyApiError ? err.body : String(err)
      warnings.push(`variations failed (etsy said: ${body}); fix in the discovery loop`)
    }
  }

  markDesignPiecesListed(db, designId)
  const result: PushResult = {
    listing_id: listingId,
    created,
    images_uploaded: imagesUploaded,
    variations_set: variationsSet,
    attributes_set: attributesSet,
    taxonomy_name: node?.name ?? null,
    warnings,
  }
  logEvent(db, 'etsy.pushed', { design_id: designId, ...result })
  return result
}
