import type { DraftListingInput, Listing, Me, ReadinessStateDefinition, ShippingProfile, TaxonomyNode } from './types'

const BASE = 'https://api.etsy.com/v3/application'

export class EtsyApiError extends Error {
  status: number
  body: string
  constructor(status: number, body: string) {
    super(`etsy api ${status}: ${body}`)
    this.status = status
    this.body = body
  }
}

export interface EtsyGateway {
  getMe(): Promise<Me>
  getShippingProfiles(shopId: number): Promise<ShippingProfile[]>
  getReadinessStateDefinitions(shopId: number): Promise<ReadinessStateDefinition[]>
  getSellerTaxonomyNodes(): Promise<TaxonomyNode[]>
  createDraftListing(shopId: number, draft: DraftListingInput): Promise<Listing>
  deleteListing(listingId: number): Promise<void>
}

export function createEtsyGateway(deps: {
  keystring: string
  sharedSecret: string
  getAccessToken: () => Promise<string>
  fetchFn?: typeof fetch
}): EtsyGateway {
  const fetchFn = deps.fetchFn ?? fetch

  async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, form?: Record<string, string | number>): Promise<T> {
    const token = await deps.getAccessToken()
    const init: RequestInit = {
      method,
      headers: {
        'x-api-key': `${deps.keystring}:${deps.sharedSecret}`,
        Authorization: `Bearer ${token}`,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(form
        ? { body: new URLSearchParams(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)]))).toString() }
        : {}),
    }
    const res = await fetchFn(`${BASE}${path}`, init)
    if (!res.ok) throw new EtsyApiError(res.status, await res.text())
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  return {
    getMe: () => request<Me>('GET', '/users/me'),

    getShippingProfiles: async (shopId) => {
      const data = await request<{ results: ShippingProfile[] }>('GET', `/shops/${shopId}/shipping-profiles`)
      return data.results
    },

    getReadinessStateDefinitions: async (shopId) => {
      const data = await request<{ results: ReadinessStateDefinition[] }>('GET', `/shops/${shopId}/readiness-state-definitions`)
      return data.results
    },

    getSellerTaxonomyNodes: async () => {
      const data = await request<{ results: TaxonomyNode[] }>('GET', '/seller-taxonomy/nodes')
      return data.results
    },

    createDraftListing: (shopId, draft) =>
      request<Listing>('POST', `/shops/${shopId}/listings`, { ...draft }),

    deleteListing: (listingId) => request<void>('DELETE', `/listings/${listingId}`),
  }
}
