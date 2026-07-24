// CLI: push a design's approved draft to Etsy. Usage: npx tsx scripts/push-listing.ts <design_id>
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { getCatalogDb, dataDir } from '../src/lib/catalog/instance'
import { etsyConfig } from '../src/lib/etsy/config'
import { getValidAccessToken } from '../src/lib/etsy/tokens'
import { createEtsyGateway, EtsyApiError } from '../src/lib/etsy/gateway'
import { pushDraftToEtsy } from '../src/lib/etsy/push'

async function main() {
  const designId = Number(process.argv[2])
  if (!Number.isFinite(designId)) throw new Error('usage: tsx scripts/push-listing.ts <design_id>')
  const cfg = etsyConfig()
  const gateway = createEtsyGateway({
    keystring: cfg.keystring,
    sharedSecret: cfg.sharedSecret,
    getAccessToken: () => getValidAccessToken(fetch, cfg.dataDir, cfg.keystring),
  })
  const result = await pushDraftToEtsy(getCatalogDb(), gateway, designId, dataDir())
  console.log(JSON.stringify(result, null, 2))
  console.log('review it in Shop Manager > Listings > Drafts; publishing stays manual')
}

main().catch((err) => {
  if (err instanceof EtsyApiError) {
    console.error(`etsy rejected a request (${err.status}); body follows for the discovery loop:`)
    console.error(err.body)
  } else {
    console.error(err)
  }
  process.exit(1)
})
