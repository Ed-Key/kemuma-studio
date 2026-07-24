// CLI: generate a dimension card for one design.
// Usage: npx tsx scripts/dimension-card.ts <design_id> [photo_id]
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { getCatalogDb, dataDir } from '../src/lib/catalog/instance'
import { getDimensionCard } from '../src/lib/catalog/dimcards'
import { rembgRunner } from '../src/lib/dimcards/cutout'
import { generateDimensionCard } from '../src/lib/dimcards/generate'

async function main() {
  const designId = Number(process.argv[2])
  if (!Number.isFinite(designId)) throw new Error('usage: tsx scripts/dimension-card.ts <design_id> [photo_id]')
  const sourcePhotoId = process.argv[3] ? Number(process.argv[3]) : undefined
  const id = await generateDimensionCard(getCatalogDb(), rembgRunner, {
    designId, dataDir: dataDir(), sourcePhotoId,
  })
  console.log(`card ${id}: ${getDimensionCard(getCatalogDb(), id)!.file_path}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
