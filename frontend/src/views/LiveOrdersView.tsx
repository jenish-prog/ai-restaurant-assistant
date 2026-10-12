import React, { useState } from 'react';
import type { Order, OrderStatus } from '../types';
import { 
  ShoppingBag, Clock, DollarSign, User, Phone, 
  MapPin, CheckCircle2, AlertCircle, ArrowUpRight, Plus, RefreshCw, Filter
} from 'lucide-react';

interface Props {
  orders: Order[];
  loading: boolean;
  onRefresh: () => void;
  onSelectOrder: (order: Order) => void;
  onUpdateStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  onOpenNewOrderModal: () => void;
}

const STATUS_CONFIG: Record<OrderStatus, { bg: string; text: string; border: string; label: string }> = {
  Pending: { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200', label: 'Pending' },
  Preparing: { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200', label: 'Preparing' },
  Ready: { bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200', label: 'Ready' },
  Delivered: { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', label: 'Delivered' },
  Cancelled: { bg: 'bg-rose-50', text: 'text-rose-800', border: 'border-rose-200', label: 'Cancelled' },
};

export const LiveOrdersView: React.FC<Props> = ({
  orders,
  loading,
  onRefresh,
  onSelectOrder,
  onUpdateStatus,
  onOpenNewOrderModal,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const filteredOrders = orders.filter(order => {
    const matchesStatus = filterStatus === 'All' || order.status.toLowerCase() === filterStatus.toLowerCase();
    const matchesSearch = 
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer_phone.includes(searchTerm) ||
      order.items.some(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  const getNextStatus = (current: OrderStatus): OrderStatus | null => {
    switch (current) {
      case 'Pending': return 'Preparing';
      case 'Preparing': return 'Ready';
      case 'Ready': return 'Delivered';
      default: return null;
    }
  };

  const handleQuickAdvance = async (e: React.MouseEvent, order: Order) => {
    e.stopPropagation();
    const next = getNextStatus(order.status);
    if (!next) return;
    try {
      setUpdatingId(order.id);
      await onUpdateStatus(order.id, next);
    } finally {
      setUpdatingId(null);
    }
  };

  // Metrics
  const activeCount = orders.filter(o => ['Pending', 'Preparing', 'Ready'].includes(o.status)).length;
  const preparingCount = orders.filter(o => o.status === 'Preparing').length;
  const readyCount = orders.filter(o => o.status === 'Ready').length;
  const totalVolume = orders.reduce((sum, o) => o.status !== 'Cancelled' ? sum + o.total : sum, 0);

  return (
    <div className="space-y-6">
      {/* Top Header & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Live Order Dispatch</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time kitchen order flow, dispatch statuses, and quick kitchen advance
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefresh}
            title="Refresh Orders"
            className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-orange-600' : ''}`} />
          </button>

          <button
            onClick={onOpenNewOrderModal}
            className="px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold text-xs transition shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Create Sample Order</span>
          </button>
        </div>
      </div>

      {/* 4 KPI Metric Banners */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600 border border-orange-100">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase font-bold tracking-wider text-slate-500">Active In-Flight</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-0.5">{activeCount}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase font-bold tracking-wider text-slate-500">In Preparation</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-0.5">{preparingCount}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600 border border-purple-100">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase font-bold tracking-wider text-slate-500">Ready for Pickup</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-0.5">{readyCount}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase font-bold tracking-wider text-slate-500">Total Shift Sales</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-0.5">₹{totalVolume.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-subtle flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          <span className="text-xs font-semibold text-slate-500 px-2 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Filter:
          </span>
          {['All', 'Pending', 'Preparing', 'Ready', 'Delivered', 'Cancelled'].map(status => {
            const count = status === 'All' 
              ? orders.length 
              : orders.filter(o => o.status.toLowerCase() === status.toLowerCase()).length;
            const isSelected = filterStatus === status;

            return (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>{status}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="w-full md:w-72">
          <input
            type="text"
            placeholder="Search order #, customer, dish..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full px-3.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
          />
        </div>
      </div>

      {/* Orders Grid */}
      {filteredOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center shadow-subtle">
          <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800">No Orders Match</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {searchTerm || filterStatus !== 'All' 
              ? 'Try adjusting your search criteria or filter to see other orders.' 
              : 'No orders recorded in database. Click below to add a sample order.'}
          </p>
          <button
            onClick={onOpenNewOrderModal}
            className="mt-4 px-4 py-2 rounded-xl bg-orange-600 text-white text-xs font-semibold inline-flex items-center gap-2 hover:bg-orange-700"
          >
            <Plus className="w-3.5 h-3.5" /> Create Sample Order
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredOrders.map(order => {
            const statusStyle = STATUS_CONFIG[order.status] || STATUS_CONFIG.Pending;
            const nextStatus = getNextStatus(order.status);
            const isUpdating = updatingId === order.id;

            return (
              <div
                key={order.id}
                onClick={() => onSelectOrder(order)}
                className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-subtle hover:shadow-card-hover transition-all cursor-pointer flex flex-col justify-between group hover:border-slate-300"
              >
                <div>
                  {/* Top Bar: Order ID, Type & Status */}
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        #{order.id}
                      </span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                        {order.order_type}
                      </span>
                    </div>

                    <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                      {statusStyle.label}
                    </span>
                  </div>

                  {/* Customer Information */}
                  <div className="py-3 space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 text-slate-800 font-semibold">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span className="truncate">{order.customer_name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-600 font-mono">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      <span>{order.customer_phone}</span>
                    </div>
                    {order.customer_address && (
                      <div className="flex items-center gap-2 text-slate-500 truncate">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{order.customer_address}</span>
                      </div>
                    )}
                  </div>

                  {/* Items list preview */}
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-100 my-1 space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Ordered Items ({order.items.reduce((s, i) => s + i.quantity, 0)})
                    </p>
                    <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs text-slate-700">
                          <span className="truncate">
                            <strong className="text-slate-900 font-semibold">{item.quantity}x</strong> {item.name}
                          </span>
                          <span className="font-medium text-slate-600 shrink-0 ml-2">
                            ₹{(item.unit_price * item.quantity).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bottom Bar: Total, Time, and Quick Status Action */}
                <div className="pt-3 border-t border-slate-100 mt-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock className="w-3 h-3" />
                      <span>{order.created_at}</span>
                    </div>
                    <div className="text-base font-extrabold text-slate-900 mt-0.5">
                      ₹{order.total.toFixed(2)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {nextStatus && (
                      <button
                        onClick={(e) => handleQuickAdvance(e, order)}
                        disabled={isUpdating}
                        className="px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-200 hover:bg-orange-600 hover:text-white text-orange-700 text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
                        title={`Advance status to ${nextStatus}`}
                      >
                        <span>{isUpdating ? 'Updating...' : `Advance → ${nextStatus}`}</span>
                      </button>
                    )}

                    <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-slate-900 group-hover:text-white text-slate-600 flex items-center justify-center transition">
                      <ArrowUpRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
