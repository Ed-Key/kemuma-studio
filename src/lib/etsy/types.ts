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
  who_made: 'i_did' | 'someone_else' | 'collective'
  when_made: string
  taxonomy_id: number
  shipping_profile_id: number
}
