import { readFile } from 'node:fs/promises'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getStagedImage } from '@/lib/catalog/staged'

export async function GET(_req: Request, { params }: { params: Promise<{ stagedId: string }> }) {
  const { stagedId } = await params
  const row = getStagedImage(getCatalogDb(), Number(stagedId))
  if (!row) return new Response('not found', { status: 404 })
  try {
    const bytes = await readFile(row.file_path)
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png' } })
  } catch {
    return new Response('file missing', { status: 404 })
  }
}
