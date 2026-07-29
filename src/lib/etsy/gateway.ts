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

export interface TaxonomyProperty {
  property_id: number
  name: string
  scales: Array<{ scale_id: number; display_name: string }>
  possible_values?: Array<{ value_id: number; name: string }>
}

const BASE = 'https://api.etsy.com/v3/application'

export class EtsyApiError extends Error {
  status: number
  body: string
  /* How long Etsy asked us to wait, when it said so. A 429 is an instruction
     with a duration attached, and guessing a shorter one just spends the next
     two attempts hearing the same answer. */
  retryAfterMs: number | null
  constructor(status: number, body: string, retryAfterMs: number | null = null) {
    super(`etsy api ${status}: ${body}`)
    this.status = status
    this.body = body
    this.retryAfterMs = retryAfterMs
  }
}

/* Etsy sends retry-after in seconds. Read defensively: this runs while an
   error is already being built, and a response without readable headers must
   not turn a useful EtsyApiError into a crash on the way out. */
export function retryAfterMs(res: unknown): number | null {
  const headers = (res as { headers?: { get?: (name: string) => string | null } } | null)?.headers
  const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : null
  if (!raw) return null
  const seconds = Number(String(raw).trim())
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

export interface EtsyGateway {
  getMe(): Promise<Me>
  getShippingProfiles(shopId: number): Promise<ShippingProfile[]>
  getReadinessStateDefinitions(shopId: number): Promise<ReadinessStateDefinition[]>
  getSellerTaxonomyNodes(): Promise<TaxonomyNode[]>
  getPropertiesByTaxonomyId(taxonomyId: number): Promise<TaxonomyProperty[]>
  updateListingProperty(shopId: number, listingId: number, propertyId: number, input: { values?: string; scale_id?: number; value_ids?: number[] }): Promise<void>
  getListing(listingId: number): Promise<Listing>
  createDraftListing(shopId: number, draft: DraftListingInput): Promise<Listing>
  deleteListing(listingId: number): Promise<void>
  updateListing(shopId: number, listingId: number, patch: ListingPatch): Promise<void>
  uploadListingImage(shopId: number, listingId: number, imageBytes: Buffer, filename: string, rank: number): Promise<void>
  uploadListingVideo(shopId: number, listingId: number, videoBytes: Buffer, filename: string): Promise<void>
  updateListingInventory(listingId: number, body: InventoryBody): Promise<void>
}

export function createEtsyGateway(deps: {
  keystring: string
  sharedSecret: string
  getAccessToken: () => Promise<string>
  fetchFn?: typeof fetch
}): EtsyGateway {
  const fetchFn = deps.fetchFn ?? fetch

  async function request<T>(method: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT', path: string, form?: Record<string, string | number | undefined>): Promise<T> {
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
    if (!res.ok) throw new EtsyApiError(res.status, await res.text(), retryAfterMs(res))
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
    if (!res.ok) throw new EtsyApiError(res.status, await res.text(), retryAfterMs(res))
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
    if (!res.ok) throw new EtsyApiError(res.status, await res.text(), retryAfterMs(res))
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

    getPropertiesByTaxonomyId: async (taxonomyId) => {
      const res = await request<{ results: TaxonomyProperty[] }>('GET', `/seller-taxonomy/nodes/${taxonomyId}/properties`)
      return res.results.map((p) => ({
        property_id: p.property_id,
        name: p.name,
        scales: (p.scales ?? []).map((s) => ({ scale_id: s.scale_id, display_name: s.display_name })),
        possible_values: p.possible_values ?? [],
      }))
    },

    // JSON, not form: value_ids is a REQUIRED array, and numeric attributes
    // (Height/Width/Depth) need it EMPTY so Etsy mints the value id itself.
    // Form encoding cannot express an empty array, which failed live with
    // "Missing input parameter: [value_ids]" (2026-07-24).
    updateListingProperty: async (shopId, listingId, propertyId, input) => {
      await requestJson<void>('PUT', `/shops/${shopId}/listings/${listingId}/properties/${propertyId}`, {
        values: input.values != null ? [input.values] : [],
        value_ids: input.value_ids ?? [],
        ...(input.scale_id != null ? { scale_id: input.scale_id } : {}),
      })
    },

    getListing: (listingId) => request<Listing>('GET', `/listings/${listingId}`),

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
    // POST /shops/{shop_id}/listings/{listing_id}/videos, multipart, fields
    // "video" and "name", scope listings_w. There is no rank: Etsy carries one
    // video per listing, so uploading a second replaces the first.
    uploadListingVideo: async (shopId, listingId, videoBytes, filename) => {
      const form = new FormData()
      const type = filename.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4'
      form.append('video', new File([new Uint8Array(videoBytes)], filename, { type }))
      form.append('name', filename)
      await requestMultipart<void>(`/shops/${shopId}/listings/${listingId}/videos`, form)
    },

    updateListingInventory: async (listingId, body) => {
      await requestJson<void>('PUT', `/listings/${listingId}/inventory`, body)
    },
  }
}
