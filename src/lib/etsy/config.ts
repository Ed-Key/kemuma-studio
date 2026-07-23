import path from 'node:path'

export function etsyConfig() {
  const keystring = process.env.ETSY_KEYSTRING
  const sharedSecret = process.env.ETSY_SHARED_SECRET
  if (!keystring || !sharedSecret) {
    throw new Error('ETSY_KEYSTRING and ETSY_SHARED_SECRET must be set in .env.local')
  }
  return {
    keystring,
    sharedSecret,
    dataDir: path.join(process.cwd(), 'data'),
    redirectUri: 'http://localhost:3000/api/etsy/callback',
    scopes: ['email_r', 'listings_r', 'listings_w', 'listings_d', 'shops_r'],
  }
}
