import React, { useState, useEffect, useCallback } from 'react';
import { api } from './services/api';
import type { MenuItem, MenuItemCreate, Order, OrderCreate, OrderStatus, CallRecord, CallRecordCreate } from './types';
import { LiveOrdersView } from './views/LiveOrdersView';
import { MenuManagementView } from './views/MenuManagementView';
import { OrderDetailsView } from './views/OrderDetailsView';
import { CallHistoryView } from './views/CallHistoryView';
import { NewOrderModal } from './components/NewOrderModal';
import { MenuModal } from './components/MenuModal';
import { SimulateCallModal } from './components/SimulateCallModal';
import { AIVoiceTesterModal } from './components/AIVoiceTesterModal';
import { 
  ShoppingBag, Utensils, FileText, PhoneCall, Plus, 
  ChefHat, AlertCircle, Menu, X, Database, Mic, Sparkles
} from 'lucide-react';

export type ActiveTab = 'live-orders' | 'menu-mgmt' | 'order-details' | 'call-history';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('live-orders');
  
  // Data State
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Loading & Sync State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  // Modals
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState<MenuItem | null>(null);
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [isVoiceTesterOpen, setIsVoiceTesterOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Data Fetch from Database
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [fetchedOrders, fetchedMenu, fetchedCalls] = await Promise.all([
        api.getOrders(),
        api.getMenu(),
        api.getCalls(),
      ]);

      setOrders(fetchedOrders);
      setMenuItems(fetchedMenu);
      setCalls(fetchedCalls);
      setLastRefreshed(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

      // Preserve or set selectedOrder
      setSelectedOrder(prev => {
        if (!prev) return fetchedOrders[0] || null;
        const stillExists = fetchedOrders.find(o => o.id === prev.id);
        return stillExists || fetchedOrders[0] || null;
      });
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Database connection error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Polling for live dashboard sync
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchData();
    }, 6000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  // Handlers for Orders
  const handleCreateOrder = async (orderData: OrderCreate) => {
    const created = await api.createOrder(orderData);
    setOrders(prev => [created, ...prev]);
    setSelectedOrder(created);
    setActiveTab('live-orders');
  };

  const handleUpdateOrderStatus = async (orderId: string, status: OrderStatus) => {
    const updated = await api.updateOrderStatus(orderId, status);
    setOrders(prev => prev.map(o => (o.id === orderId ? updated : o)));
    if (selectedOrder?.id === orderId) {
      setSelectedOrder(updated);
    }
  };

  const handleSelectOrder = (order: Order) => {
    setSelectedOrder(order);
    setActiveTab('order-details');
  };

  const handleSelectOrderById = (orderId: string) => {
    const matched = orders.find(o => o.id === orderId);
    if (matched) {
      setSelectedOrder(matched);
      setActiveTab('order-details');
    }
  };

  // Handlers for Menu
  const handleSaveMenuItem = async (itemData: MenuItemCreate) => {
    if (editingMenuItem) {
      const updated = await api.updateMenuItem(editingMenuItem.id, itemData);
      setMenuItems(prev => prev.map(item => (item.id === editingMenuItem.id ? updated : item)));
    } else {
      const added = await api.addMenuItem(itemData);
      setMenuItems(prev => [...prev, added]);
    }
    setEditingMenuItem(null);
  };

  const handleToggleMenuAvailability = async (itemId: string) => {
    const updated = await api.toggleItemAvailability(itemId);
    setMenuItems(prev => prev.map(item => (item.id === itemId ? updated : item)));
  };

  const handleDeleteMenuItem = async (itemId: string) => {
    await api.deleteMenuItem(itemId);
    setMenuItems(prev => prev.filter(item => item.id !== itemId));
  };

  const handleOpenAddMenuItem = () => {
    setEditingMenuItem(null);
    setIsMenuModalOpen(true);
  };

  const handleOpenEditMenuItem = (item: MenuItem) => {
    setEditingMenuItem(item);
    setIsMenuModalOpen(true);
  };

  // Handlers for Calls
  const handleCreateCall = async (callData: CallRecordCreate) => {
    const created = await api.createCall(callData);
    setCalls(prev => [created, ...prev]);
    setActiveTab('call-history');
  };

  // Counters
  const liveActiveCount = orders.filter(o => ['Pending', 'Preparing', 'Ready'].includes(o.status)).length;
  const incomingCallsCount = calls.filter(c => c.status === 'incoming').length;
  const unavailableMenuCount = menuItems.filter(i => !i.is_available).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row font-sans selection:bg-slate-900 selection:text-white">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-72 bg-slate-900 text-white flex flex-col justify-between shrink-0 shadow-xl z-20 border-r border-slate-800">
        <div>
          {/* Brand Header */}
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-600 text-white flex items-center justify-center font-bold shadow-md shadow-orange-600/20">
                <ChefHat className="w-5 h-5" />
              </div>
              <div>
                <span className="text-base font-bold tracking-tight text-white block">
                  Aura Dining
                </span>
                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  Kitchen OS
                </span>
              </div>
            </div>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

          {/* Navigation Items */}
          <nav className={`p-3 space-y-1.5 ${mobileMenuOpen ? 'block' : 'hidden md:block'}`}>
            {/* Screen 1: Live Orders */}
            <button
              onClick={() => { setActiveTab('live-orders'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition ${
                activeTab === 'live-orders'
                  ? 'bg-orange-600 text-white font-semibold shadow-md shadow-orange-600/20'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <ShoppingBag className="w-4 h-4 shrink-0" />
                <span className="whitespace-nowrap">1. Live Orders</span>
              </div>
              {liveActiveCount > 0 && (
                <span className={`shrink-0 whitespace-nowrap text-[11px] font-bold px-2 py-0.5 rounded-full inline-flex items-center justify-center leading-normal ${
                  activeTab === 'live-orders' ? 'bg-white text-orange-700' : 'bg-emerald-500 text-white'
                }`}>
                  {liveActiveCount}
                </span>
              )}
            </button>

            {/* Screen 2: Menu Management */}
            <button
              onClick={() => { setActiveTab('menu-mgmt'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition ${
                activeTab === 'menu-mgmt'
                  ? 'bg-orange-600 text-white font-semibold shadow-md shadow-orange-600/20'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Utensils className="w-4 h-4 shrink-0" />
                <span className="whitespace-nowrap">2. Menu Management</span>
              </div>
              {unavailableMenuCount > 0 && (
                <span className={`shrink-0 whitespace-nowrap text-[11px] font-bold px-2.5 py-0.5 rounded-full inline-flex items-center justify-center leading-normal ${
                  activeTab === 'menu-mgmt' ? 'bg-white text-orange-700' : 'bg-rose-500 text-white shadow-sm'
                }`}>
                  {unavailableMenuCount} out
                </span>
              )}
            </button>

            {/* Screen 3: Order Details */}
            <button
              onClick={() => { setActiveTab('order-details'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition ${
                activeTab === 'order-details'
                  ? 'bg-orange-600 text-white font-semibold shadow-md shadow-orange-600/20'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="w-4 h-4 shrink-0" />
                <span className="whitespace-nowrap">3. Order Details</span>
              </div>
              {selectedOrder && (
                <span className={`shrink-0 whitespace-nowrap text-[11px] font-mono px-2 py-0.5 rounded leading-normal ${
                  activeTab === 'order-details' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'
                }`}>
                  #{selectedOrder.id}
                </span>
              )}
            </button>

            {/* Screen 4: Call History */}
            <button
              onClick={() => { setActiveTab('call-history'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition ${
                activeTab === 'call-history'
                  ? 'bg-orange-600 text-white font-semibold shadow-md shadow-orange-600/20'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <PhoneCall className="w-4 h-4 shrink-0" />
                <span className="whitespace-nowrap">4. Call History</span>
              </div>
              {incomingCallsCount > 0 && (
                <span className="shrink-0 whitespace-nowrap text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 animate-pulse inline-flex items-center justify-center leading-normal">
                  {incomingCallsCount} live
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* Database & Quick Order Panel in Sidebar */}
        <div className="p-4 border-t border-slate-800 space-y-3 hidden md:block">
          <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/60 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 flex items-center gap-1.5 font-medium">
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                SQLite DB
              </span>
              <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-semibold border border-emerald-500/20">
                Connected
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Auto-Sync:</span>
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                  autoRefresh ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'
                }`}
              >
                {autoRefresh ? 'Active (6s)' : 'Paused'}
              </button>
            </div>
          </div>

          <button
            onClick={() => setIsVoiceTesterOpen(true)}
            className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-semibold text-xs transition shadow-md shadow-orange-600/25 flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-amber-200" />
            <span>Test AI Voice (Google Studio)</span>
          </button>

          <button
            onClick={() => setIsNewOrderModalOpen(true)}
            className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs transition border border-slate-700 flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4 text-slate-400" />
            <span>Manual Sample Order</span>
          </button>
        </div>
      </aside>

      {/* Main App Content */}
      <main className="flex-1 flex flex-col min-h-screen overflow-x-hidden bg-slate-50">
        {/* Top Navbar */}
        <header className="bg-white border-b border-slate-200/80 px-6 lg:px-8 py-3.5 flex items-center justify-between sticky top-0 z-10 shadow-subtle">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-semibold text-slate-800">restaurant.db (Active)</span>
              <span className="text-slate-400 hidden sm:inline">•</span>
              <span className="text-slate-500 hidden sm:inline">Last sync: {lastRefreshed || 'Just now'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsVoiceTesterOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white text-xs font-semibold transition shadow-md shadow-orange-600/20 flex items-center gap-2"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Test AI Voice</span>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-200 animate-ping"></span>
            </button>

            <button
              onClick={() => setIsCallModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition flex items-center gap-1.5 border border-slate-200"
            >
              <PhoneCall className="w-3.5 h-3.5 text-slate-600" />
              <span>Simulate Call</span>
            </button>

            <button
              onClick={() => setIsNewOrderModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition shadow-sm flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Order</span>
            </button>
          </div>
        </header>

        {/* Global DB Error Notice */}
        {error && (
          <div className="mx-6 lg:mx-8 mt-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="font-medium">{error}</span>
            </div>
            <button
              onClick={fetchData}
              className="px-3 py-1 rounded-lg bg-rose-600 text-white font-medium text-xs hover:bg-rose-700"
            >
              Retry Sync
            </button>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'live-orders' && (
            <LiveOrdersView
              orders={orders}
              loading={loading}
              onRefresh={fetchData}
              onSelectOrder={handleSelectOrder}
              onUpdateStatus={handleUpdateOrderStatus}
              onOpenNewOrderModal={() => setIsNewOrderModalOpen(true)}
            />
          )}

          {activeTab === 'menu-mgmt' && (
            <MenuManagementView
              menuItems={menuItems}
              loading={loading}
              onRefresh={fetchData}
              onAddItem={handleOpenAddMenuItem}
              onEditItem={handleOpenEditMenuItem}
              onToggleAvailability={handleToggleMenuAvailability}
              onDeleteItem={handleDeleteMenuItem}
            />
          )}

          {activeTab === 'order-details' && (
            <OrderDetailsView
              selectedOrder={selectedOrder}
              allOrders={orders}
              onSelectOrder={setSelectedOrder}
              onBackToLiveOrders={() => setActiveTab('live-orders')}
              onUpdateStatus={handleUpdateOrderStatus}
              onNavigateToCall={(_callId) => {
                setActiveTab('call-history');
              }}
            />
          )}

          {activeTab === 'call-history' && (
            <CallHistoryView
              calls={calls}
              loading={loading}
              onRefresh={fetchData}
              onOpenSimulateModal={() => setIsCallModalOpen(true)}
              onSelectOrderById={handleSelectOrderById}
            />
          )}
        </div>
      </main>

      {/* Modals */}
      <NewOrderModal
        isOpen={isNewOrderModalOpen}
        onClose={() => setIsNewOrderModalOpen(false)}
        menuItems={menuItems}
        onSubmit={handleCreateOrder}
      />

      <MenuModal
        isOpen={isMenuModalOpen}
        onClose={() => {
          setIsMenuModalOpen(false);
          setEditingMenuItem(null);
        }}
        onSubmit={handleSaveMenuItem}
        editingItem={editingMenuItem}
      />

      <SimulateCallModal
        isOpen={isCallModalOpen}
        onClose={() => setIsCallModalOpen(false)}
        onSubmit={handleCreateCall}
      />

      <AIVoiceTesterModal
        isOpen={isVoiceTesterOpen}
        onClose={() => setIsVoiceTesterOpen(false)}
        onOrderPlaced={fetchData}
        onCallLogged={fetchData}
      />
    </div>
  );
};

export default App;
