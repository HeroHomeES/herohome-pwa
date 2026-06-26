export interface AppNotification {
  id: string
  user_id: string
  type: 'new_visit_request' | 'visit_confirmed' | 'visit_canceled' | 'new_offer' | 'offer_updated'
  payload: Record<string, unknown> | null
  read: boolean | null
  created_at: string | null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface VisitSlot {
  id: string
  property_id: string
  start_time: string
  end_time: string
  status: 'Available' | 'Pending to confirm' | 'Confirmed' | 'Canceled by owner' | 'Canceled by visitor' | 'Not available' | null
  visitor_name: string | null
  visitor_last_name: string | null
  visitor_phone: string | null
  visitor_dni: string | null
  visitor_email: string | null
  salesforce_event_id: string | null
  consent_given: boolean | null
  consent_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface AvailabilityDay {
  day_of_week: number
  from_hour: number
  to_hour: number
  is_active: boolean
}

export interface Offer {
  id: string
  property_id: string
  parent_offer_id: string | null
  initiated_by: 'Buyer' | 'Owner'
  buyer_name: string | null
  buyer_phone: string | null
  amount: number
  status: 'Presented' | 'Accepted' | 'Denied' | null
  created_at: string | null
  updated_at: string | null
}

export interface Property {
  id: string
  salesforce_account_id: string
  user_id: string
  idealista_listing_id: string | null
  street: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  housing_type: 'Piso' | 'Chalet' | 'Ático' | 'Dúplex' | 'Estudio' | 'Finca rústica' | null
  rooms: number | null
  bathrooms: number | null
  built_area: number | null
  useful_surface_area: number | null
  age: number | null
  floor: number | null
  has_elevator: boolean | null
  is_exterior: boolean | null
  orientation: 'Norte' | 'Sur' | 'Este' | 'Oeste' | 'Sureste' | 'Suroeste' | 'Noreste' | 'Noroeste' | null
  heating_type: 'No disponible' | 'Central' | 'Individual - Eléctrica' | 'Individual Gas' | 'Individual Otros' | null
  condition: 'Nueva o recién reformada' | 'Buen estado' | 'Para reformar' | null
  community_fee: number | null
  electronic_certificate: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'En trámite' | null
  sales_price: number | null
  reject_offers_below: number | null
  owner_fee_percent: number | null
  owner_fee: number | null
  buyer_fee_percent: number | null
  buyer_fee: number | null
  ref_catastral: string | null
  description: string | null
  status: 'On Sale' | 'Sold' | 'Contract cancelled' | null
  garage_space: 'Sin plaza de garaje' | 'Con 1 plaza de garaje' | 'Con 2 plazas de garaje' | 'Con 3 plazas de garaje' | null
  registro_propiedad: number | null
  sf_last_sync_at: string | null
  created_at: string | null
  updated_at: string | null
}
