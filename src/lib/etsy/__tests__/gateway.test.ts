import { describe, it, expect, vi } from 'vitest'
import { createEtsyGateway, EtsyApiError } from '@/lib/etsy/gateway'

function jsonResponse(value: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => value, text: async () => JSON.stringify(value) } as unknown as Response
}

function gatewayWith(fetchFn: ReturnType<typeof vi.fn>) {
  return createEtsyGateway({
    keystring: 'k123',
    sharedSecret: 's3cr3t',
    getAccessToken: async () => 'tok',
    fetchFn: fetchFn as unknown as typeof fetch,
  })
}

describe('gateway', () => {
  it('sends auth headers on getMe', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ user_id: 7, shop_id: 42 }))
    const me = await gatewayWith(fetchFn).getMe()
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.etsy.com/v3/application/users/me')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('k123:s3cr3t')
    expect(headers['Authorization']).toBe('Bearer tok')
    expect(me).toEqual({ user_id: 7, shop_id: 42 })
  })

  it('posts a form-encoded draft listing', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ listing_id: 9, state: 'draft', title: 't' }))
    const listing = await gatewayWith(fetchFn).createDraftListing(42, {
      quantity: 1, title: 't', description: 'd', price: 999,
      who_made: 'someone_else', when_made: '1990s', taxonomy_id: 1, shipping_profile_id: 5,
    })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.etsy.com/v3/application/shops/42/listings')
    expect(init.method).toBe('POST')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('title')).toBe('t')
    expect(body.get('price')).toBe('999')
    expect(body.get('when_made')).toBe('1990s')
    expect(listing.listing_id).toBe(9)
  })

  it('unwraps results arrays for shipping profiles', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ count: 1, results: [{ shipping_profile_id: 5, title: 'USPS' }] }))
    const profiles = await gatewayWith(fetchFn).getShippingProfiles(42)
    expect(profiles).toEqual([{ shipping_profile_id: 5, title: 'USPS' }])
  })

  it('deletes a listing and tolerates an empty body', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }) as unknown as Response)
    await gatewayWith(fetchFn).deleteListing(9)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.etsy.com/v3/application/listings/9')
    expect(init.method).toBe('DELETE')
  })

  it('throws EtsyApiError with status and body on failure', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'missing taxonomy_id' }, 400))
    const err = await gatewayWith(fetchFn).getMe().catch((e) => e)
    expect(err).toBeInstanceOf(EtsyApiError)
    expect(err.status).toBe(400)
    expect(err.body).toContain('missing taxonomy_id')
  })
})
