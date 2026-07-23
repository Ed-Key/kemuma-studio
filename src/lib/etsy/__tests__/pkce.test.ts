import { describe, it, expect } from 'vitest'
import { generateVerifier, challengeFromVerifier, buildAuthorizeUrl } from '@/lib/etsy/pkce'

describe('pkce', () => {
  it('generates a 43-char base64url verifier', () => {
    const v = generateVerifier()
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generateVerifier()).not.toBe(v)
  })

  it('computes the RFC 7636 appendix B challenge', () => {
    // Known test vector from RFC 7636 appendix B
    expect(challengeFromVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  it('builds the etsy authorize url', () => {
    const url = new URL(
      buildAuthorizeUrl({
        keystring: 'k123',
        redirectUri: 'http://localhost:3000/api/etsy/callback',
        scopes: ['listings_r', 'shops_r'],
        state: 'st8',
        challenge: 'ch4',
      })
    )
    expect(url.origin + url.pathname).toBe('https://www.etsy.com/oauth/connect')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('k123')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/etsy/callback')
    expect(url.searchParams.get('scope')).toBe('listings_r shops_r')
    expect(url.searchParams.get('state')).toBe('st8')
    expect(url.searchParams.get('code_challenge')).toBe('ch4')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})
