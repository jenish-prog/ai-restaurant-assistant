import React, { useState } from 'react';
import type { MenuItem, OrderItem, OrderCreate } from '../types';
import { X, Plus, Minus, ShoppingBag, User, Phone, MapPin, FileText, Check } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  menuItems: MenuItem[];
  onSubmit: (orderData: OrderCreate) => Promise<void>;
}

export const NewOrderModal: React.FC<Props> = ({ isOpen, onClose, menuItems, onSubmit }) => {
  const [customerName, setCustomerName] = useState('Sarah Jenkins');
  const [customerPhone, setCustomerPhone] = useState('+1 (555) 345-6789');
  const [customerAddress, setCustomerAddress] = useState('Sector 18, Block B, Flat 402');
  const [orderType, setOrderType] = useState('Takeout');
  const [notes, setNotes] = useState('Please include napkins and extra cutlery.');
  const [selectedItems, setSelectedItems] = useState<{ [itemId: string]: number }>({});
  const [itemNotes, setItemNotes] = useState<{ [itemId: string]: string }>({});
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleQuantityChange = (itemId: string, delta: number) => {
    setSelectedItems(prev => {
      const current = prev[itemId] || 0;
      const next = Math.max(0, current + delta);
      const copy = { ...prev };
      if (next === 0) {
        delete copy[itemId];
      } else {
        copy[itemId] = next;
      }
      return copy;
    });
  };

  const handleOrderTypeChange = (type: string) => {
    setOrderType(type);
    if (type === 'Delivery') {
      setDeliveryFee(40);
    } else {
      setDeliveryFee(0);
    }
  };

  // Calculations
  const orderItemsList: OrderItem[] = Object.entries(selectedItems)
    .map(([itemId, qty]) => {
      const item = menuItems.find(m => m.id === itemId);
      if (!item) return null;
      return {
        item_id: item.id,
        name: item.name,
        quantity: qty,
        unit_price: item.price,
        notes: itemNotes[item.id] || undefined,
      };
    })
    .filter(Boolean) as OrderItem[];

  const subtotal = orderItemsList.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const tax = Number((subtotal * 0.05).toFixed(2));
  const total = Number((subtotal + tax + deliveryFee).toFixed(2));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (orderItemsList.length === 0) {
      setError('Please add at least one item to the order.');
      return;
    }

    if (!customerName.trim() || !customerPhone.trim()) {
      setError('Please provide customer name and phone number.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customer_address: customerAddress.trim() || undefined,
        order_type: orderType,
        items: orderItemsList,
        notes: notes.trim() || undefined,
        delivery_fee: deliveryFee,
      });
      // reset form
      setSelectedItems({});
      setItemNotes({});
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save order to database');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-slate-900">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-md">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Create Manual Order</h2>
              <p className="text-xs text-slate-300">Creates a persistent order record in SQLite database</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs font-medium">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Customer Details Column */}
            <div className="space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200">
              <h3 className="font-semibold text-slate-800 text-xs uppercase tracking-wider flex items-center gap-2">
                <User className="w-4 h-4 text-slate-600" /> Customer Contact
              </h3>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Customer Full Name *</label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 text-xs"
                    placeholder="e.g. John Doe"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number *</label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="tel"
                    required
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 text-xs"
                    placeholder="e.g. +1 (555) 000-0000"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Order Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {['Takeout', 'Delivery', 'Dine-in'].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleOrderTypeChange(type)}
                      className={`py-2 text-xs font-medium rounded-lg border transition ${
                        orderType === type
                          ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {orderType === 'Dine-in' ? 'Table Number' : 'Delivery Address'}
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={customerAddress}
                    onChange={e => setCustomerAddress(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 text-xs"
                    placeholder={orderType === 'Dine-in' ? 'Table 4 (Indoor)' : 'Street address & apt'}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Kitchen / Delivery Notes</label>
                <div className="relative">
                  <FileText className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 text-xs"
                    placeholder="Allergies, door codes, extra sauce..."
                  />
                </div>
              </div>
            </div>

            {/* Menu Items Selector Column */}
            <div className="space-y-4 flex flex-col">
              <h3 className="font-semibold text-slate-800 text-xs uppercase tracking-wider flex items-center justify-between">
                <span>Select Items from Menu</span>
                <span className="text-xs font-normal text-slate-500">{orderItemsList.length} items added</span>
              </h3>

              <div className="flex-1 overflow-y-auto max-h-[280px] space-y-2 pr-1">
                {menuItems.map(item => {
                  const qty = selectedItems[item.id] || 0;
                  return (
                    <div
                      key={item.id}
                      className={`p-3 rounded-xl border transition flex items-center justify-between gap-3 ${
                        qty > 0
                          ? 'border-orange-500 bg-orange-50/40 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-xs text-slate-900 truncate">{item.name}</p>
                          {!item.is_available && (
                            <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded font-medium">
                              Unavailable
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono">₹{item.price.toFixed(2)} • {item.category}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item.id, -1)}
                          disabled={qty === 0}
                          className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center hover:bg-slate-200 disabled:opacity-40 transition"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-6 text-center text-xs font-bold text-slate-900">{qty}</span>
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item.id, 1)}
                          className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center hover:bg-slate-800 transition"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Order Calculation Summary */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-semibold font-mono text-slate-900">₹{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>GST (5%):</span>
                  <span className="font-semibold font-mono text-slate-900">₹{tax.toFixed(2)}</span>
                </div>
                {deliveryFee > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Delivery Fee:</span>
                    <span className="font-semibold font-mono text-slate-900">₹{deliveryFee.toFixed(2)}</span>
                  </div>
                )}
                <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-bold text-slate-900">
                  <span>Calculated Total:</span>
                  <span className="text-base text-slate-900 font-mono">₹{total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 font-medium text-xs transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || orderItemsList.length === 0}
              className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold text-xs transition shadow-sm flex items-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <span>Writing to Database...</span>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Place Order (₹{total.toFixed(2)})</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
