import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getPhotoPath } from '@/lib/catalog/catalog'

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
}

export async function GET(_req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params
  const filePath = getPhotoPath(getCatalogDb(), Number(photoId))
  if (!filePath) return new Response('not found', { status: 404 })
  try {
    const bytes = await readFile(filePath)
    const type = TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': type } })
  } catch {
    return new Response('file missing', { status: 404 })
  }
}
