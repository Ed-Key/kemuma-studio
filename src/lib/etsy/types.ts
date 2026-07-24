export interface Me {
  user_id: number
  shop_id: number
}

export interface ShippingProfile {
  shipping_profile_id: number
  title: string
}

export interface TaxonomyNode {
  id: number
  name: string
  children: TaxonomyNode[]
}

export interface ReadinessStateDefinition {
  readiness_state_id: number
  readiness_state: string
}

export interface Listing {
  listing_id: number
  state: string
  title: string
}

export interface DraftListingInput {
  quantity: number
  title: string
  description: string
  price: number
  tags?: string
  materials?: string
  who_made: 'i_did' | 'someone_else' | 'collective'
  when_made: string
  taxonomy_id: number
  shipping_profile_id: number
  readiness_state_id: number
  // Required by calculated-shipping profiles; harmless otherwise.
  item_weight?: number
  item_weight_unit?: 'oz' | 'lb' | 'g' | 'kg'
  item_length?: number
  item_width?: number
  item_height?: number
  item_dimensions_unit?: 'in' | 'ft' | 'mm' | 'cm' | 'm' | 'yd'
}

export interface ListingPatch {
  title?: string
  description?: string
  tags?: string
  materials?: string
  price?: number
  item_weight?: number
  item_weight_unit?: string
  item_length?: number
  item_width?: number
  item_height?: number
  item_dimensions_unit?: string
}

export interface InventoryBody {
  products: Array<{
    sku?: string
    property_values: Array<{ property_id: number; property_name: string; values: string[] }>
    offerings: Array<{ price: number; quantity: number; is_enabled: boolean }>
  }>
}
