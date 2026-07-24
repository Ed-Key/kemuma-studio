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
      readiness_state_id: 3,
      item_weight: 2, item_weight_unit: 'lb',
      item_length: 5, item_width: 3, item_height: 3, item_dimensions_unit: 'in',
    })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.etsy.com/v3/application/shops/42/listings')
    expect(init.method).toBe('POST')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('title')).toBe('t')
    expect(body.get('price')).toBe('999')
    expect(body.get('when_made')).toBe('1990s')
    expect(body.get('readiness_state_id')).toBe('3')
    expect(body.get('item_weight')).toBe('2')
    expect(body.get('item_dimensions_unit')).toBe('in')
    expect(listing.listing_id).toBe(9)
  })

  it('omits undefined optional fields from the form body', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ listing_id: 9, state: 'draft', title: 't' }))
    await gatewayWith(fetchFn).createDraftListing(42, {
      quantity: 1, title: 't', description: 'd', price: 999,
      who_made: 'someone_else', when_made: '1990s', taxonomy_id: 1, shipping_profile_id: 5,
      readiness_state_id: 3,
    })
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    const body = new URLSearchParams(init.body as string)
    expect(body.has('item_weight')).toBe(false)
    expect((init.body as string).includes('undefined')).toBe(false)
  })

  it('unwraps results arrays for readiness state definitions', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ count: 1, results: [{ readiness_state_id: 3, readiness_state: 'ready_to_ship' }] }))
    const defs = await gatewayWith(fetchFn).getReadinessStateDefinitions(42)
    const [url] = fetchFn.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://api.etsy.com/v3/application/shops/42/readiness-state-definitions')
    expect(defs).toEqual([{ readiness_state_id: 3, readiness_state: 'ready_to_ship' }])
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

  it('patches listing fields form-encoded, dropping undefined', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }) as unknown as Response)
    await gatewayWith(fetchFn).updateListing(42, 9, { title: 'new title', price: 59 })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.etsy.com/v3/application/shops/42/listings/9')
    expect(init.method).toBe('PATCH')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('title')).toBe('new title')
    expect(body.get('price')).toBe('59')
    expect(body.has('description')).toBe(false)
  })

  it('uploads an image as multipart with rank', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 201, text: async () => '{}' }) as unknown as Response)
    await gatewayWith(fetchFn).uploadListingImage(42, 9, Buffer.from('jpegbytes'), '0.jpg', 1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.etsy.com/v3/application/shops/42/listings/9/images')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('rank')).toBe('1')
    const file = form.get('image') as File
    expect(file.name).toBe('0.jpg')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined() // fetch sets the multipart boundary itself
    expect(headers['x-api-key']).toBe('k123:s3cr3t')
  })

  it('puts inventory as json', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }) as unknown as Response)
    const body = {
      products: [
        {
          property_values: [{ property_id: 513, property_name: 'Colorway', values: ['blue'] }],
          offerings: [{ price: 58, quantity: 1, is_enabled: true }],
        },
      ],
    }
    await gatewayWith(fetchFn).updateListingInventory(9, body)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.etsy.com/v3/application/listings/9/inventory')
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual(body)
  })

  it('fetches taxonomy properties and unwraps results', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        count: 1,
        results: [{ property_id: 505, name: 'Height', scales: [{ scale_id: 347, display_name: 'Inches' }] }],
      })
    )
    const props = await gatewayWith(fetchFn).getPropertiesByTaxonomyId(1060)
    const [url] = fetchFn.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://api.etsy.com/v3/application/seller-taxonomy/nodes/1060/properties')
    expect(props).toEqual([
      { property_id: 505, name: 'Height', scales: [{ scale_id: 347, display_name: 'Inches' }] },
    ])
  })

  it('puts a form-encoded listing property with its scale', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}))
    await gatewayWith(fetchFn).updateListingProperty(42, 9, 505, { values: '3', scale_id: 347 })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.etsy.com/v3/application/shops/42/listings/9/properties/505')
    expect(init.method).toBe('PUT')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('values')).toBe('3')
    expect(body.get('scale_id')).toBe('347')
  })
})
