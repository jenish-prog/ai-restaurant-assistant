import React, { useState } from 'react';
import type { Order, OrderStatus } from '../types';
import { 
  ArrowLeft, User, Phone, MapPin, Clock, 
  Printer, AlertCircle, Copy, Check, PhoneCall
} from 'lucide-react';

interface Props {
  selectedOrder: Order | null;
  allOrders: Order[];
  onSelectOrder: (order: Order) => void;
  onBackToLiveOrders: () => void;
  onUpdateStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  onNavigateToCall?: (callId: string) => void;
}

const STATUS_STEPS: OrderStatus[] = ['Pending', 'Preparing', 'Ready', 'Delivered'];

export const OrderDetailsView: React.FC<Props> = ({
  selectedOrder,
  allOrders,
  onSelectOrder,
  onBackToLiveOrders,
  onUpdateStatus,
  onNavigateToCall,
}) => {
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [printSuccess, setPrintSuccess] = useState(false);

  const order = selectedOrder || allOrders[0] || null;

  if (!order) {
    return (
      <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center shadow-subtle">
        <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="text-base font-bold text-slate-800">No Order Selected</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">
          Select an order from the live board to inspect its complete details.
        </p>
        <button
          onClick={onBackToLiveOrders}
          className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold inline-flex items-center gap-2 hover:bg-slate-800"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Live Orders
        </button>
      </div>
    );
  }

  const handleCopyPhone = () => {
    navigator.clipboard.writeText(order.customer_phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const handleStatusChange = async (newStatus: OrderStatus) => {
    try {
      setIsUpdating(true);
      await onUpdateStatus(order.id, newStatus);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSimulatePrint = () => {
    setPrintSuccess(true);
    setTimeout(() => setPrintSuccess(false), 2500);
  };

  const currentStepIdx = STATUS_STEPS.indexOf(order.status);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Navigation & Order Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToLiveOrders}
            className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition shadow-sm"
            title="Back to Live Orders"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Order #{order.id}</h1>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                {order.order_type}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Placed at {order.created_at}
            </p>
          </div>
        </div>

        {/* Dropdown to switch orders quickly */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500 hidden md:block">Switch Order:</label>
          <select
            value={order.id}
            onChange={(e) => {
              const matched = allOrders.find(o => o.id === e.target.value);
              if (matched) onSelectOrder(matched);
            }}
            className="px-3 py-1.5 bg-white rounded-lg border border-slate-200 text-xs font-medium text-slate-800 focus:ring-2 focus:ring-slate-900 shadow-sm"
          >
            {allOrders.map(o => (
              <option key={o.id} value={o.id}>
                #{o.id} - {o.customer_name} (₹{o.total.toFixed(2)} - {o.status})
              </option>
            ))}
          </select>

          <button
            onClick={handleSimulatePrint}
            className="px-3.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium transition flex items-center gap-1.5 shadow-sm"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>{printSuccess ? 'Printed!' : 'Kitchen Slip'}</span>
          </button>
        </div>
      </div>

      {/* Fulfillment Pipeline Stepper */}
      <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-subtle">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Order Fulfillment Pipeline
          </h3>
          <span className="text-xs font-medium text-slate-600">
            Current Phase: <strong className="text-slate-900 font-bold">{order.status}</strong>
          </span>
        </div>

        {order.status === 'Cancelled' ? (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            This order has been cancelled.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
            {STATUS_STEPS.map((step, idx) => {
              const isPast = currentStepIdx >= idx;
              const isCurrent = order.status === step;

              return (
                <button
                  key={step}
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleStatusChange(step)}
                  className={`p-3 rounded-xl border text-left transition flex items-center gap-3 ${
                    isCurrent
                      ? 'bg-orange-600 text-white border-orange-600 shadow-sm'
                      : isPast
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100'
                      : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    isCurrent
                      ? 'bg-white text-orange-600'
                      : isPast
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}>
                    {isPast && !isCurrent ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                  </div>
                  <div>
                    <p className="text-xs font-bold leading-tight">{step}</p>
                    <p className={`text-[10px] ${isCurrent ? 'text-orange-100' : 'opacity-70'}`}>
                      {isCurrent ? 'Active Now' : isPast ? 'Done' : 'Click to Set'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Customer Contact Details Card (1 Col) */}
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-subtle space-y-4">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500 flex items-center gap-2 border-b border-slate-100 pb-3">
              <User className="w-4 h-4 text-slate-600" /> Customer Details
            </h3>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Customer Name</span>
              <p className="text-base font-bold text-slate-900 mt-0.5">{order.customer_name}</p>
            </div>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Phone Number</span>
              <div className="flex items-center justify-between gap-2 mt-1 bg-slate-50 p-2 rounded-lg border border-slate-200">
                <span className="text-xs font-semibold text-slate-800 flex items-center gap-2 font-mono">
                  <Phone className="w-3.5 h-3.5 text-slate-500" /> {order.customer_phone}
                </span>
                <button
                  onClick={handleCopyPhone}
                  className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition"
                  title="Copy Phone"
                >
                  {copiedPhone ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {order.customer_address && (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  {order.order_type === 'Dine-in' ? 'Table Location' : 'Delivery Address'}
                </span>
                <p className="text-xs text-slate-700 mt-1 flex items-start gap-1.5 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                  <span>{order.customer_address}</span>
                </p>
              </div>
            )}

            {order.notes && (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Special Cooking Notes</span>
                <p className="text-xs text-amber-900 mt-1 italic bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                  "{order.notes}"
                </p>
              </div>
            )}

            {order.call_id && (
              <div className="pt-2 border-t border-slate-100">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Origin Channel</span>
                <button
                  type="button"
                  onClick={() => onNavigateToCall && onNavigateToCall(order.call_id!)}
                  className="w-full text-left p-2.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 transition flex items-center justify-between"
                >
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <PhoneCall className="w-3.5 h-3.5 text-orange-600" />
                    Linked Call: {order.call_id}
                  </span>
                  <span className="text-[10px] font-bold text-orange-600 hover:underline">View Call →</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Complete Order Items & Calculated Total (2 Cols) */}
        <div className="md:col-span-2 space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-subtle space-y-4">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500 flex items-center justify-between border-b border-slate-100 pb-3">
              <span>Itemized Order Summary</span>
              <span className="text-xs font-semibold text-slate-600">
                {order.items.reduce((sum, item) => sum + item.quantity, 0)} total items
              </span>
            </h3>

            {/* Items Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="pb-2 font-bold uppercase tracking-wider">Dish</th>
                    <th className="pb-2 font-bold uppercase tracking-wider text-center">Qty</th>
                    <th className="pb-2 font-bold uppercase tracking-wider text-right">Unit Price</th>
                    <th className="pb-2 font-bold uppercase tracking-wider text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {order.items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70">
                      <td className="py-3 pr-2">
                        <p className="font-semibold text-sm text-slate-900">{item.name}</p>
                        {item.notes && (
                          <p className="text-[11px] text-slate-500 italic mt-0.5">
                            Note: {item.notes}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-2 text-center font-bold text-slate-800 text-sm">
                        {item.quantity}
                      </td>
                      <td className="py-3 px-2 text-right text-slate-500 font-medium font-mono">
                        ₹{item.unit_price.toFixed(2)}
                      </td>
                      <td className="py-3 pl-2 text-right font-bold text-slate-900 text-sm font-mono">
                        ₹{(item.unit_price * item.quantity).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Calculated Receipt Breakdown Card */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Food & Beverage Subtotal:</span>
                <span className="font-semibold font-mono text-slate-800">₹{order.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>GST (5%):</span>
                <span className="font-semibold font-mono text-slate-800">₹{order.tax.toFixed(2)}</span>
              </div>
              {order.delivery_fee > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Delivery & Dispatch Fee:</span>
                  <span className="font-semibold font-mono text-slate-800">₹{order.delivery_fee.toFixed(2)}</span>
                </div>
              )}
              <div className="pt-3 border-t border-slate-200 flex justify-between items-baseline text-slate-900">
                <div>
                  <span className="text-base font-bold">Calculated Grand Total</span>
                  <span className="text-[10px] text-slate-500 block">Taxes and delivery charges included</span>
                </div>
                <span className="text-2xl font-black text-slate-900 font-mono">
                  ₹{order.total.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Quick Status Modifiers */}
            <div className="pt-2 flex items-center justify-between gap-3">
              <button
                onClick={() => handleStatusChange('Cancelled')}
                disabled={order.status === 'Cancelled' || isUpdating}
                className="px-3.5 py-2 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition disabled:opacity-40"
              >
                Cancel Order
              </button>

              <div className="flex items-center gap-2">
                {order.status === 'Pending' && (
                  <button
                    onClick={() => handleStatusChange('Preparing')}
                    disabled={isUpdating}
                    className="px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 transition shadow-sm"
                  >
                    Send to Kitchen (Preparing)
                  </button>
                )}
                {order.status === 'Preparing' && (
                  <button
                    onClick={() => handleStatusChange('Ready')}
                    disabled={isUpdating}
                    className="px-4 py-2 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 transition shadow-sm"
                  >
                    Mark Ready for Pickup/Dispatch
                  </button>
                )}
                {order.status === 'Ready' && (
                  <button
                    onClick={() => handleStatusChange('Delivered')}
                    disabled={isUpdating}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition shadow-sm"
                  >
                    Complete & Deliver Order
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
