import { readFile } from 'node:fs/promises'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getDimensionCard } from '@/lib/catalog/dimcards'

export async function GET(_req: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params
  const row = getDimensionCard(getCatalogDb(), Number(cardId))
  if (!row) return new Response('not found', { status: 404 })
  try {
    const bytes = await readFile(row.file_path)
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg' } })
  } catch {
    return new Response('file missing', { status: 404 })
  }
}
