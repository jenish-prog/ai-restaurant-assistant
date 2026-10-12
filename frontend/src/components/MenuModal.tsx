import React, { useState, useEffect } from 'react';
import type { MenuItem, MenuItemCreate } from '../types';
import { X, Utensils, Clock, Tag, AlignLeft, Image } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (itemData: MenuItemCreate) => Promise<void>;
  editingItem?: MenuItem | null;
}

const CATEGORIES = ['Mains', 'Starters', 'Pizzas', 'Sides', 'Desserts', 'Beverages'];

export const MenuModal: React.FC<Props> = ({ isOpen, onClose, onSubmit, editingItem }) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Mains');
  const [price, setPrice] = useState<string>('280.00');
  const [description, setDescription] = useState('');
  const [prepTime, setPrepTime] = useState<string>('15');
  const [imageUrl, setImageUrl] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingItem) {
      setName(editingItem.name);
      setCategory(editingItem.category);
      setPrice(editingItem.price.toString());
      setDescription(editingItem.description);
      setPrepTime(editingItem.prep_time_mins.toString());
      setImageUrl(editingItem.image_url || '');
      setIsAvailable(editingItem.is_available);
    } else {
      setName('');
      setCategory('Mains');
      setPrice('280.00');
      setDescription('');
      setPrepTime('15');
      setImageUrl('');
      setIsAvailable(true);
    }
  }, [editingItem, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedPrice = parseFloat(price);
    const parsedPrepTime = parseInt(prepTime, 10);

    if (!name.trim()) {
      setError('Item name is required.');
      return;
    }

    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      setError('Please enter a valid price greater than 0.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        name: name.trim(),
        category,
        price: parsedPrice,
        description: description.trim(),
        prep_time_mins: isNaN(parsedPrepTime) ? 15 : parsedPrepTime,
        image_url: imageUrl.trim() || undefined,
        is_available: isAvailable,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save menu item to database');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg flex flex-col overflow-hidden text-slate-900">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-md">
              <Utensils className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                {editingItem ? 'Edit Menu Item & Price' : 'Add New Food Item'}
              </h2>
              <p className="text-xs text-slate-300">Saves directly to SQLite menu_items table</p>
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
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Item Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Braised Short Rib Gnocchi"
              className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-slate-400" /> Category
              </label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white text-xs font-medium"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <span className="font-bold text-slate-500">₹</span> Price (₹ INR) *
              </label>
              <input
                type="number"
                step="5"
                required
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="280.00"
                className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white text-xs font-semibold font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" /> Prep Time (Minutes)
              </label>
              <input
                type="number"
                value={prepTime}
                onChange={e => setPrepTime(e.target.value)}
                placeholder="15"
                className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Availability Status</label>
              <div className="flex items-center gap-3 pt-2">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAvailable}
                    onChange={e => setIsAvailable(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  <span className="ml-2 text-xs font-medium text-slate-700">
                    {isAvailable ? 'Available' : 'Unavailable'}
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
              <AlignLeft className="w-3.5 h-3.5 text-slate-400" /> Description & Ingredients
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Fresh farm ingredients, delicate seasoning..."
              className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
              <Image className="w-3.5 h-3.5 text-slate-400" /> Image URL (optional)
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              placeholder="https://images.unsplash.com/..."
              className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white text-xs"
            />
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
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold text-xs transition shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? 'Saving to Database...' : editingItem ? 'Save Changes' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
