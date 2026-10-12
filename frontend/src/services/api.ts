import type { MenuItem, MenuItemCreate, Order, OrderCreate, OrderStatus, CallRecord, CallRecordCreate, DashboardStats, VoiceStatusResponse } from '../types';

const API_BASE = 'http://127.0.0.1:8000/api';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  } catch (err: any) {
    // Backend down / refused: name the URL instead of a bare TypeError.
    throw new Error(`API unreachable [${url}]: ${err?.message || 'network error'}. Is the backend running?`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API Error [${response.status}] at ${url}: ${errorBody || response.statusText}`);
  }

  // Validate before parsing: proxies / SPA fallbacks may return HTML
  // (e.g. "<!doctype ...>") which would otherwise surface as a cryptic
  // "Unexpected token '<' ... is not valid JSON".
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const preview = (await response.text()).slice(0, 120);
    throw new Error(
      `API Error at ${url}: expected JSON but got '${contentType || 'unknown content-type'}' (status ${response.status}): ${preview}`
    );
  }

  return response.json() as Promise<T>;
}

export const api = {
  // Menu
  getMenu: async (category?: string): Promise<MenuItem[]> => {
    const query = category && category !== 'All' ? `?category=${encodeURIComponent(category)}` : '';
    return request<MenuItem[]>(`/menu${query}`);
  },

  addMenuItem: async (item: MenuItemCreate): Promise<MenuItem> => {
    return request<MenuItem>('/menu', {
      method: 'POST',
      body: JSON.stringify(item),
    });
  },

  updateMenuItem: async (id: string, updates: Partial<MenuItemCreate>): Promise<MenuItem> => {
    return request<MenuItem>(`/menu/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  toggleItemAvailability: async (id: string): Promise<MenuItem> => {
    return request<MenuItem>(`/menu/${id}/toggle-availability`, {
      method: 'PATCH',
    });
  },

  deleteMenuItem: async (id: string): Promise<{ message: string; id: string }> => {
    return request<{ message: string; id: string }>(`/menu/${id}`, {
      method: 'DELETE',
    });
  },

  // Orders
  getOrders: async (status?: string, search?: string): Promise<Order[]> => {
    const params = new URLSearchParams();
    if (status && status !== 'All') params.append('status', status);
    if (search) params.append('search', search);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<Order[]>(`/orders${query}`);
  },

  getOrderById: async (id: string): Promise<Order> => {
    return request<Order>(`/orders/${id}`);
  },

  createOrder: async (order: OrderCreate): Promise<Order> => {
    return request<Order>('/orders', {
      method: 'POST',
      body: JSON.stringify(order),
    });
  },

  updateOrderStatus: async (id: string, status: OrderStatus): Promise<Order> => {
    return request<Order>(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  // Calls
  getCalls: async (status?: string): Promise<CallRecord[]> => {
    const query = status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : '';
    return request<CallRecord[]>(`/calls${query}`);
  },

  createCall: async (call: CallRecordCreate): Promise<CallRecord> => {
    return request<CallRecord>('/calls', {
      method: 'POST',
      body: JSON.stringify(call),
    });
  },

  // Stats
  getStats: async (): Promise<DashboardStats> => {
    return request<DashboardStats>('/stats');
  },

  // AI Voice Assistant (Google AI Studio)
  // NOTE: there is no POST /api/voice/interact on the backend — the live
  // voice path is the WebSocket at /api/voice-simulator/stream. Do not add a
  // client for a nonexistent route here.
  getVoiceStatus: async (): Promise<VoiceStatusResponse> => {
    return request<VoiceStatusResponse>('/voice/status');
  },
};
