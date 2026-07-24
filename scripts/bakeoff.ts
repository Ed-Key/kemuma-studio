// CLI: run the model bake-off for one design.
// Usage: BAKEOFF_MODELS="anthropic:claude-opus-4-8,gemini:gemini-2.5-flash,xai:grok-4" npx tsx scripts/bakeoff.ts <design_id>
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { getCatalogDb } from '../src/lib/catalog/instance'
import { bakeoffSpecs } from '../src/lib/writer/providers'
import { runBakeoff } from '../src/lib/writer/bakeoff'

async function main() {
  const designId = Number(process.argv[2])
  if (!Number.isFinite(designId)) throw new Error('usage: tsx scripts/bakeoff.ts <design_id>')
  const specs = bakeoffSpecs()
  console.log(`bake-off for design ${designId}: ${specs.join(' vs ')}`)
  const results = await runBakeoff(getCatalogDb(), designId, specs)
  console.log(JSON.stringify(results, null, 2))
  console.log(`blind review: http://localhost:3000/designs/${designId}/bakeoff`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
