// One place that knows how to reach a listing on Etsy. The editor URL works for
// drafts; the public URL 404s until the owner publishes by hand, so callers must
// gate it on published_at.
//
// The shop URL is the storefront as a buyer arrives at it. Everything below it
// is the seller side, which only answers to a signed-in owner.
export const SHOP_URL = 'https://www.etsy.com/shop/KemumaCarvings'
export const SHOP_LISTINGS_URL = 'https://www.etsy.com/your/shops/me/tools/listings'
export const SHOP_DRAFTS_URL = 'https://www.etsy.com/your/shops/me/tools/listings/state:draft'

export function listingEditorUrl(listingId: number): string {
  return `https://www.etsy.com/your/shops/me/listing-editor/edit/${listingId}`
}

export function listingPublicUrl(listingId: number): string {
  return `https://www.etsy.com/listing/${listingId}`
}
