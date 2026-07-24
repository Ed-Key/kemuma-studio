// CLI: generate a listing draft for one design. Usage: npx tsx scripts/generate-draft.ts <design_id>
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { getCatalogDb } from '../src/lib/catalog/instance'
import { getDesignDetail } from '../src/lib/catalog/catalog'
import { latestDraftForDesign } from '../src/lib/catalog/drafts'
import { createClaudeWriter, generateDraft, writerModel } from '../src/lib/writer/generate'

async function main() {
  const designId = Number(process.argv[2])
  if (!Number.isFinite(designId)) throw new Error('usage: tsx scripts/generate-draft.ts <design_id>')
  const db = getCatalogDb()
  const detail = getDesignDetail(db, designId)
  if (!detail) throw new Error(`design ${designId} not found`)
  console.log(`generating draft for "${detail.name}" with ${writerModel()}...`)
  const draftId = await generateDraft(db, createClaudeWriter(), designId)
  const record = latestDraftForDesign(db, designId)!
  console.log(`draft ${draftId} stored (status: ${record.status})`)
  console.log(JSON.stringify(JSON.parse(record.generated_json), null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
