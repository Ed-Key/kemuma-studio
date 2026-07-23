import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { etsyConfig } from '../src/lib/etsy/config'
import { getValidAccessToken } from '../src/lib/etsy/tokens'
import { createEtsyGateway, EtsyApiError } from '../src/lib/etsy/gateway'
import type { TaxonomyNode } from '../src/lib/etsy/types'

function findNode(nodes: TaxonomyNode[], match: string): TaxonomyNode | null {
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(match)) return node
    const hit = findNode(node.children ?? [], match)
    if (hit) return hit
  }
  return null
}

async function main() {
  const cfg = etsyConfig()
  const gateway = createEtsyGateway({
    keystring: cfg.keystring,
    sharedSecret: cfg.sharedSecret,
    getAccessToken: () => getValidAccessToken(fetch, cfg.dataDir, cfg.keystring),
  })

  const me = await gateway.getMe()
  console.log(`connected: user ${me.user_id}, shop ${me.shop_id}`)

  const profiles = await gateway.getShippingProfiles(me.shop_id)
  if (profiles.length === 0) throw new Error('no shipping profiles on the shop; create one in Etsy shop settings first')
  console.log(`using shipping profile: ${profiles[0].title} (${profiles[0].shipping_profile_id})`)

  const taxonomy = await gateway.getSellerTaxonomyNodes()
  const node = findNode(taxonomy, 'sculpture') ?? taxonomy[0]
  console.log(`using taxonomy node: ${node.name} (${node.id})`)

  const listing = await gateway.createDraftListing(me.shop_id, {
    quantity: 1,
    title: 'TEST DO NOT BUY kemuma-studio api handshake',
    description: 'Temporary draft created by the kemuma-studio handshake script. It deletes itself.',
    price: 999,
    who_made: 'someone_else',
    when_made: '1990s',
    taxonomy_id: node.id,
    shipping_profile_id: profiles[0].shipping_profile_id,
  })
  console.log(`created draft listing ${listing.listing_id} (state: ${listing.state})`)
  console.log('check Etsy Shop Manager > Listings > Drafts if you want to see it, then press Enter within 60s... deleting in 60s regardless')
  await new Promise((r) => setTimeout(r, 60_000))

  await gateway.deleteListing(listing.listing_id)
  console.log(`deleted draft listing ${listing.listing_id}`)
  console.log('HANDSHAKE COMPLETE')
}

main().catch((err) => {
  if (err instanceof EtsyApiError) {
    console.error(`etsy rejected a request (${err.status}). Body follows; a missing-field message here is expected discovery, add the field and rerun:`)
    console.error(err.body)
  } else {
    console.error(err)
  }
  process.exit(1)
})
