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
import { vocabForFamily } from './attribute-vocab'

export interface PushResult {
  listing_id: number
  created: boolean
  images_uploaded: number
  variations_set: boolean
  attributes_set: number
  taxonomy_name: string | null
  warnings: string[]
}

/** Etsy's first custom variation slot, which this shop uses for colorway. */
const COLORWAY_PROPERTY_ID = 513

export function buildInventoryProducts(
  pieces: Array<{ colorway: string; quantity: number }>,
  price: number,
  readinessStateId: number
): InventoryBody {
  // Live-API discovery 2026-07-25: a listing whose colorways hold different
  // stock counts is rejected with "quantity must be consistent across all
  // products" unless the property the count varies on is declared. Colorways
  // are exactly that for this shop (the canoe dish is 1 maroon and 4 assorted),
  // so name the property whenever the counts actually differ. Leaving it off
  // when they match is the truthful description of a listing where they do not.
  const quantities = new Set(pieces.map((p) => p.quantity))
  return {
    products: pieces.map((p) => ({
      property_values: [{ property_id: COLORWAY_PROPERTY_ID, property_name: 'Colorway', values: [p.colorway] }],
      // Live-API discovery 2026-07-24: etsy rejects offerings without a
      // readiness state ("All offerings need readiness state").
      offerings: [{ price, quantity: p.quantity, is_enabled: true, readiness_state_id: readinessStateId }],
    })),
    ...(quantities.size > 1 ? { quantity_on_property: [COLORWAY_PROPERTY_ID] } : {}),
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
  // Shipping dimensions describe the PARCEL, not the piece's own orientation, and
  // Etsy requires item_length to be the longest side. Mapping length to the piece's
  // depth made tall carvings send their shortest side as length, which Etsy rejects
  // as shipping_profile_no_domestic_option (live-confirmed 2026-07-24: the same
  // payload succeeds once the sides are sorted).
  const [parcelLength, parcelWidth, parcelHeight] = [height, width, depth].sort((a, b) => b - a)

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
      item_length: parcelLength,
      item_width: parcelWidth,
      item_height: parcelHeight,
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
      item_length: parcelLength,
      item_width: parcelWidth,
      item_height: parcelHeight,
      item_dimensions_unit: 'in',
    })
  }

  const vocab = vocabForFamily(detail.family)
  const draftAttrs = draft as { primary_color?: string | null; secondary_color?: string | null; art_style?: string | null }
  let attributesSet = 0
  try {
    const props = await gateway.getPropertiesByTaxonomyId(taxonomyId)
    const findProp = (name: string) => props.find((p) => p.name === name)
    const valueId = (name: string, valueName: string) =>
      findProp(name)?.possible_values?.find((v) => v.name.toLowerCase() === valueName.toLowerCase())?.value_id

    // Predefined-value attributes: material (fixed), colors + art style (from draft).
    const valueAttrs: Array<{ prop: string; value: string | null | undefined }> = [
      { prop: vocab.materialProperty, value: vocab.materialValue },
      { prop: 'Primary color', value: draftAttrs.primary_color },
      { prop: 'Secondary color', value: draftAttrs.secondary_color },
      ...(vocab.artStyleProperty ? [{ prop: vocab.artStyleProperty, value: draftAttrs.art_style ?? null }] : []),
      ...(vocab.mountProperty ? [{ prop: vocab.mountProperty, value: vocab.mountValue ?? null }] : []),
    ]
    for (const attr of valueAttrs) {
      if (!attr.value) continue
      const prop = findProp(attr.prop)
      const vid = valueId(attr.prop, attr.value)
      if (!prop || vid == null) {
        warnings.push(`${attr.prop} value "${attr.value}" not available in this category; skipped`)
        continue
      }
      try {
        await gateway.updateListingProperty(me.shop_id, listingId, prop.property_id, { values: attr.value, value_ids: [vid] })
        attributesSet += 1
      } catch (err) {
        warnings.push(`${attr.prop} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Dimension attributes (scaled): Width/Height/Depth in inches.
    if (vocab.hasDimensions) {
      const dims: Array<{ name: string; value: number }> = [
        { name: 'Height', value: height },
        { name: 'Width', value: width },
        { name: 'Depth', value: depth },
      ]
      for (const d of dims) {
        const prop = findProp(d.name)
        const scale = prop?.scales.find((s) => s.display_name === 'Inches')
        if (!prop || !scale) {
          warnings.push(`no ${d.name} attribute in this category; skipped`)
          continue
        }
        try {
          await gateway.updateListingProperty(me.shop_id, listingId, prop.property_id, { values: String(d.value), scale_id: scale.scale_id })
          attributesSet += 1
        } catch (err) {
          warnings.push(`${d.name} attribute failed: ${err instanceof Error ? err.message : String(err)}`)
        }
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
  db.prepare(
    warnings.length > 0
      ? 'UPDATE designs SET push_warnings_json = ?, push_warned_at = ? WHERE design_id = ?'
      : 'UPDATE designs SET push_warnings_json = NULL, push_warned_at = NULL WHERE design_id = ?'
  ).run(...(warnings.length > 0 ? [JSON.stringify(warnings), new Date().toISOString(), designId] : [designId]))
  logEvent(db, 'etsy.pushed', { design_id: designId, ...result })
  return result
}
