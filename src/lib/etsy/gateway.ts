import type {
  DraftListingInput,
  InventoryBody,
  Listing,
  ListingPatch,
  Me,
  ReadinessStateDefinition,
  ShippingProfile,
  TaxonomyNode,
} from './types'

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
  updateListing(shopId: number, listingId: number, patch: ListingPatch): Promise<void>
  uploadListingImage(shopId: number, listingId: number, imageBytes: Buffer, filename: string, rank: number): Promise<void>
  updateListingInventory(listingId: number, body: InventoryBody): Promise<void>
}

export function createEtsyGateway(deps: {
  keystring: string
  sharedSecret: string
  getAccessToken: () => Promise<string>
  fetchFn?: typeof fetch
}): EtsyGateway {
  const fetchFn = deps.fetchFn ?? fetch

  async function request<T>(method: 'GET' | 'POST' | 'DELETE' | 'PATCH', path: string, form?: Record<string, string | number | undefined>): Promise<T> {
    const token = await deps.getAccessToken()
    const init: RequestInit = {
      method,
      headers: {
        'x-api-key': `${deps.keystring}:${deps.sharedSecret}`,
        Authorization: `Bearer ${token}`,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(form
        ? {
            body: new URLSearchParams(
              Object.fromEntries(
                Object.entries(form)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => [k, String(v)])
              )
            ).toString(),
          }
        : {}),
    }
    const res = await fetchFn(`${BASE}${path}`, init)
    if (!res.ok) throw new EtsyApiError(res.status, await res.text())
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  async function requestJson<T>(method: 'PUT' | 'PATCH', path: string, body: unknown): Promise<T> {
    const token = await deps.getAccessToken()
    const res = await fetchFn(`${BASE}${path}`, {
      method,
      headers: {
        'x-api-key': `${deps.keystring}:${deps.sharedSecret}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new EtsyApiError(res.status, await res.text())
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  async function requestMultipart<T>(path: string, form: FormData): Promise<T> {
    const token = await deps.getAccessToken()
    const res = await fetchFn(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'x-api-key': `${deps.keystring}:${deps.sharedSecret}`,
        Authorization: `Bearer ${token}`,
        // no Content-Type: fetch sets the multipart boundary
      },
      body: form,
    })
    if (!res.ok) throw new EtsyApiError(res.status, await res.text())
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

    updateListing: async (shopId, listingId, patch) => {
      await request<void>('PATCH', `/shops/${shopId}/listings/${listingId}`, { ...patch })
    },

    uploadListingImage: async (shopId, listingId, imageBytes, filename, rank) => {
      const form = new FormData()
      form.append('image', new File([new Uint8Array(imageBytes)], filename, { type: 'image/jpeg' }))
      form.append('rank', String(rank))
      await requestMultipart<void>(`/shops/${shopId}/listings/${listingId}/images`, form)
    },

    updateListingInventory: async (listingId, body) => {
      await requestJson<void>('PUT', `/listings/${listingId}/inventory`, body)
    },
  }
}
