import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { buildAuthorizeUrl, challengeFromVerifier, generateVerifier } from '@/lib/etsy/pkce'
import { savePending } from '@/lib/etsy/tokens'
import { etsyConfig } from '@/lib/etsy/config'

export async function GET() {
  const cfg = etsyConfig()
  const verifier = generateVerifier()
  const state = randomBytes(16).toString('hex')
  await savePending(cfg.dataDir, { state, verifier })
  const url = buildAuthorizeUrl({
    keystring: cfg.keystring,
    redirectUri: cfg.redirectUri,
    scopes: cfg.scopes,
    state,
    challenge: challengeFromVerifier(verifier),
  })
  return NextResponse.redirect(url)
}
