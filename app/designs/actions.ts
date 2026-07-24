'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCatalogDb, dataDir } from '@/lib/catalog/instance'
import { addPhoto, addPiece, createDesign, getDesignDetail } from '@/lib/catalog/catalog'
import { photoDiskPath, savePhotoFile } from '@/lib/catalog/photos-fs'
import type { ActionResult } from '../components/action-result'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function createDesignAction(formData: FormData) {
  const family = String(formData.get('family') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim()
  if (!family || !name) throw new Error('family and name are required')
  const id = createDesign(getCatalogDb(), { family, name })
  redirect(`/designs/${id}`)
}

export async function addPieceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const num = (key: string) => {
      const v = Number(formData.get(key))
      if (!Number.isFinite(v) || v <= 0) throw new Error(`${key} must be a positive number`)
      return v
    }
    addPiece(getCatalogDb(), {
      design_id: designId,
      colorway: String(formData.get('colorway') ?? '').trim() || 'natural',
      height_in: num('height_in'),
      width_in: num('width_in'),
      depth_in: num('depth_in'),
      weight_lb: num('weight_lb'),
      quantity: Math.max(1, Math.floor(Number(formData.get('quantity')) || 1)),
    })
    revalidatePath(`/designs/${designId}`)
    return { ok: true, message: 'Piece added.' }
  } catch (err) {
    return { ok: false, message: 'Could not add the piece.', detail: errText(err) }
  }
}

export async function uploadPhotosAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const db = getCatalogDb()
    const pieceId = Number(formData.get('piece_id'))
    const designId = Number(formData.get('design_id'))
    const detail = designId ? getDesignDetail(db, designId) : null
    const existing = detail?.pieces.find((p) => p.piece_id === pieceId)?.photos.length ?? 0
    const files = formData.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0)
    if (files.length === 0) throw new Error('choose at least one photo')
    let position = existing
    for (const file of files) {
      const diskPath = photoDiskPath(dataDir(), pieceId, position, file.name)
      await savePhotoFile(diskPath, Buffer.from(await file.arrayBuffer()))
      addPhoto(db, { piece_id: pieceId, file_path: diskPath, position })
      position += 1
    }
    revalidatePath(`/designs/${designId}`)
    return { ok: true, message: `Added ${files.length} photo${files.length === 1 ? '' : 's'}.` }
  } catch (err) {
    return { ok: false, message: 'Could not upload photos.', detail: errText(err) }
  }
}

export async function markPublishedAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const designId = Number(formData.get('design_id'))
    const { markDesignPublished } = await import('@/lib/catalog/catalog')
    markDesignPublished(getCatalogDb(), designId)
    revalidatePath(`/designs/${designId}`)
    revalidatePath('/designs')
    return { ok: true, message: 'Marked as published.' }
  } catch (err) {
    return { ok: false, message: 'Could not mark it published.', detail: errText(err) }
  }
}

// Etsy knows whether a listing is live; the studio should not make Ed remember.
// Reads the real state for every pushed design and records it.
export async function syncEtsyStatesAction(): Promise<ActionResult> {
  try {
    const db = getCatalogDb()
    const { designsWithListings, setDesignPublished } = await import('@/lib/catalog/catalog')
    const { createEtsyGateway } = await import('@/lib/etsy/gateway')
    const { getValidAccessToken } = await import('@/lib/etsy/tokens')
    const { etsyConfig } = await import('@/lib/etsy/config')
    const cfg = etsyConfig()
    const gateway = createEtsyGateway({
      keystring: cfg.keystring,
      sharedSecret: cfg.sharedSecret,
      getAccessToken: () => getValidAccessToken(fetch, cfg.dataDir, cfg.keystring),
    })

    const rows = designsWithListings(db)
    let live = 0
    const warnings: string[] = []
    for (const row of rows) {
      try {
        const listing = await gateway.getListing(row.etsy_listing_id)
        const isLive = listing.state === 'active'
        setDesignPublished(db, row.design_id, isLive)
        if (isLive) live += 1
        // Etsy allows 5 requests a second; keep well under it.
        await new Promise((r) => setTimeout(r, 250))
      } catch (err) {
        warnings.push(`${row.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    revalidatePath('/designs')
    return {
      ok: true,
      message: `Synced ${rows.length} listings from Etsy.`,
      detail: `${live} live, ${rows.length - live} still draft`,
      warnings,
    }
  } catch (err) {
    return { ok: false, message: 'Could not sync from Etsy.', detail: errText(err) }
  }
}
