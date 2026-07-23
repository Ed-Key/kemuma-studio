import { createHash, randomBytes } from 'node:crypto'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateVerifier(): string {
  return base64url(randomBytes(32))
}

export function challengeFromVerifier(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

export function buildAuthorizeUrl(opts: {
  keystring: string
  redirectUri: string
  scopes: string[]
  state: string
  challenge: string
}): string {
  const url = new URL('https://www.etsy.com/oauth/connect')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', opts.keystring)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('scope', opts.scopes.join(' '))
  url.searchParams.set('state', opts.state)
  url.searchParams.set('code_challenge', opts.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}
