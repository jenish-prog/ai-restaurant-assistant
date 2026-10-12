export interface MenuItem {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  is_available: boolean;
  prep_time_mins: number;
  image_url?: string;
}

export interface MenuItemCreate {
  name: string;
  category: string;
  description: string;
  price: number;
  is_available: boolean;
  prep_time_mins: number;
  image_url?: string;
}

export interface OrderItem {
  item_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  notes?: string;
}

export type OrderStatus = 'Pending' | 'Preparing' | 'Ready' | 'Delivered' | 'Cancelled';

export interface Order {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address?: string;
  order_type: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  delivery_fee: number;
  total: number;
  status: OrderStatus;
  created_at: string;
  notes?: string;
  call_id?: string;
}

export interface OrderCreate {
  customer_name: string;
  customer_phone: string;
  customer_address?: string;
  order_type: string;
  items: OrderItem[];
  notes?: string;
  delivery_fee?: number;
  call_id?: string;
}

export type CallStatus = 'completed' | 'abandoned' | 'failed' | 'incoming';
export type CallSentiment = 'positive' | 'neutral' | 'frustrated';

export interface CallRecord {
  id: string;
  caller_name: string;
  caller_phone: string;
  call_time: string;
  duration_seconds: number;
  status: CallStatus;
  sentiment: CallSentiment;
  transcript_summary: string;
  order_id?: string;
  notes?: string;
}

export interface CallRecordCreate {
  caller_name: string;
  caller_phone: string;
  duration_seconds: number;
  status: CallStatus;
  sentiment: CallSentiment;
  transcript_summary: string;
  order_id?: string;
  notes?: string;
}

export interface DashboardStats {
  live_orders_count: number;
  total_orders_count: number;
  delivered_orders_count: number;
  total_revenue: number;
  calls: {
    total: number;
    completed: number;
    abandoned: number;
    failed: number;
    incoming: number;
  };
}

export interface VoiceInteractionResponse {
  voice_reply: string;
  sentiment: CallSentiment;
  intent: string;
  detected_items: {
    item_id: string;
    name: string;
    quantity: number;
    unit_price: number;
  }[];
  order_created: Order | null;
  call_record: CallRecord;
  source: string;
  provider_status: string;
}

export interface VoiceStatusResponse {
  google_ai_studio_configured: boolean;
  key_preview: string | null;
  default_model: string;
  culinary_engine_active: boolean;
}

