import type { Db } from '@/lib/catalog/db'
import { logEvent } from '@/lib/catalog/catalog'
import { generateDraft, type ListingWriter } from './generate'
import { createWriterFor } from './providers'

export async function runBakeoff(
  db: Db,
  designId: number,
  specs: string[],
  makeWriter: (spec: string) => ListingWriter = createWriterFor
): Promise<Array<{ spec: string; draft_id?: number; error?: string }>> {
  const results: Array<{ spec: string; draft_id?: number; error?: string }> = []
  for (const spec of specs) {
    try {
      const draftId = await generateDraft(db, makeWriter(spec), designId)
      results.push({ spec, draft_id: draftId })
    } catch (err) {
      results.push({ spec, error: err instanceof Error ? err.message : String(err) })
    }
  }
  logEvent(db, 'bakeoff.ran', { design_id: designId, results })
  return results
}
