import React, { useState } from 'react';
import type { MenuItem } from '../types';
import { 
  Plus, Edit3, Trash2, Clock, CheckCircle, XCircle, Search, 
  UtensilsCrossed, AlertCircle, RefreshCw 
} from 'lucide-react';

interface Props {
  menuItems: MenuItem[];
  loading: boolean;
  onRefresh: () => void;
  onAddItem: () => void;
  onEditItem: (item: MenuItem) => void;
  onToggleAvailability: (itemId: string) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
}

export const MenuManagementView: React.FC<Props> = ({
  menuItems,
  loading,
  onRefresh,
  onAddItem,
  onEditItem,
  onToggleAvailability,
  onDeleteItem,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const categories = ['All', 'Mains', 'Starters', 'Pizzas', 'Sides', 'Desserts', 'Beverages'];

  const filteredItems = menuItems.filter(item => {
    const matchesCategory = activeCategory === 'All' || item.category.toLowerCase() === activeCategory.toLowerCase();
    const matchesSearch = 
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleToggle = async (itemId: string) => {
    try {
      setActionInProgress(itemId);
      await onToggleAvailability(itemId);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDelete = async (itemId: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete "${name}" from the menu?`)) {
      try {
        setActionInProgress(itemId);
        await onDeleteItem(itemId);
      } finally {
        setActionInProgress(null);
      }
    }
  };

  const totalItems = menuItems.length;
  const availableItems = menuItems.filter(i => i.is_available).length;
  const unavailableItems = totalItems - availableItems;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Menu Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage food catalog, edit item prices, update ingredients, and mark items unavailable
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefresh}
            title="Refresh Menu"
            className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-orange-600' : ''}`} />
          </button>
          <button
            onClick={onAddItem}
            className="px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold text-xs transition shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add Food Item</span>
          </button>
        </div>
      </div>

      {/* Metric Counters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 border border-slate-200">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase font-bold tracking-wider text-slate-500">Total Catalog Dishes</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-0.5">{totalItems}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase font-bold tracking-wider text-slate-500">Active & Serving</p>
            <p className="text-2xl font-extrabold text-emerald-700 mt-0.5">{availableItems}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600 border border-rose-100">
            <XCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase font-bold tracking-wider text-slate-500">Marked Unavailable</p>
            <p className="text-2xl font-extrabold text-rose-700 mt-0.5">{unavailableItems}</p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-subtle flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {categories.map(cat => {
            const count = cat === 'All'
              ? menuItems.length
              : menuItems.filter(i => i.category.toLowerCase() === cat.toLowerCase()).length;
            const isSelected = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>{cat}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search dish or ingredients..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
          />
        </div>
      </div>

      {/* Menu Item Cards */}
      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center shadow-subtle">
          <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800">No Dishes Found</h3>
          <p className="text-xs text-slate-500 mt-1">
            No dishes match the selected category or search query.
          </p>
          <button
            onClick={onAddItem}
            className="mt-4 px-4 py-2 rounded-xl bg-orange-600 text-white text-xs font-semibold inline-flex items-center gap-2 hover:bg-orange-700"
          >
            <Plus className="w-3.5 h-3.5" /> Add New Dish
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredItems.map(item => {
            const isProcessing = actionInProgress === item.id;
            return (
              <div
                key={item.id}
                className={`bg-white rounded-xl border transition-all flex flex-col justify-between overflow-hidden shadow-subtle hover:shadow-card-hover group ${
                  item.is_available 
                    ? 'border-slate-200/80' 
                    : 'border-rose-200 bg-slate-50/50'
                }`}
              >
                <div>
                  {/* Image & Quick Status Overlay */}
                  <div className="relative h-44 w-full bg-slate-100 overflow-hidden">
                    <img
                      src={item.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80'}
                      alt={item.name}
                      className={`w-full h-full object-cover transition duration-300 group-hover:scale-105 ${
                        !item.is_available ? 'grayscale contrast-75 opacity-75' : ''
                      }`}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&auto=format&fit=crop&q=80';
                      }}
                    />

                    {/* Category pill */}
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide uppercase bg-slate-900/85 text-white backdrop-blur-sm">
                      {item.category}
                    </span>

                    {/* Availability Pill */}
                    <span
                      className={`absolute top-3 right-3 px-2 py-0.5 rounded-md text-[11px] font-bold shadow-sm ${
                        item.is_available
                          ? 'bg-emerald-600 text-white'
                          : 'bg-rose-600 text-white'
                      }`}
                    >
                      {item.is_available ? 'Serving' : 'Unavailable'}
                    </span>

                    {/* Prep time badge */}
                    <div className="absolute bottom-2 left-3 flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 text-white text-[10px] backdrop-blur-sm">
                      <Clock className="w-3 h-3" />
                      <span>{item.prep_time_mins} mins</span>
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-sm text-slate-900 group-hover:text-orange-600 transition">
                        {item.name}
                      </h3>
                      <span className="text-sm font-extrabold text-slate-900 shrink-0">
                        ₹{item.price.toFixed(2)}
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="p-4 pt-2 border-t border-slate-100 bg-slate-50/70 space-y-3">
                  {/* Availability Switch */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-600">Kitchen Availability:</span>
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleToggle(item.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition border flex items-center gap-1.5 ${
                        item.is_available
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                      }`}
                    >
                      {item.is_available ? (
                        <>
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Mark Unavailable</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Mark Available</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Actions buttons */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/60">
                    <button
                      onClick={() => onEditItem(item)}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium transition flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Edit Price & Info</span>
                    </button>

                    <button
                      onClick={() => handleDelete(item.id, item.name)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition"
                      title="Delete Dish"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
