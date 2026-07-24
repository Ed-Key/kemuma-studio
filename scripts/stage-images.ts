// CLI: stage marketing images for one design.
// Usage: npx tsx scripts/stage-images.ts <design_id> [scene_key] [photo_id]
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { getCatalogDb, dataDir } from '../src/lib/catalog/instance'
import { getStagedImage } from '../src/lib/catalog/staged'
import { createClaudeArtDirector } from '../src/lib/staging/direct'
import { runStaging } from '../src/lib/staging/stage'

async function main() {
  const designId = Number(process.argv[2])
  if (!Number.isFinite(designId)) {
    throw new Error('usage: tsx scripts/stage-images.ts <design_id> [scene_key] [photo_id]')
  }
  const sceneKey = process.argv[3] || undefined
  const sourcePhotoId = process.argv[4] ? Number(process.argv[4]) : undefined
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const db = getCatalogDb()
  console.log(`staging design ${designId}${sceneKey ? ` in scene ${sceneKey}` : ''}...`)
  const ids = await runStaging(
    db,
    { artDirector: createClaudeArtDirector(), fetchFn: fetch, apiKey },
    { designId, dataDir: dataDir(), sceneKey, sourcePhotoId }
  )
  for (const id of ids) {
    const row = getStagedImage(db, id)!
    console.log(`staged ${id}: ${row.file_path} ($${row.cost_usd?.toFixed(3)})`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
