import React, { useState } from 'react';
import type { CallRecord, CallStatus } from '../types';
import { 
  PhoneCall, PhoneIncoming, PhoneOff, AlertTriangle, CheckCircle, 
  Clock, User, MessageSquare, ArrowRight, Plus, RefreshCw, Filter
} from 'lucide-react';

interface Props {
  calls: CallRecord[];
  loading: boolean;
  onRefresh: () => void;
  onOpenSimulateModal: () => void;
  onSelectOrderById?: (orderId: string) => void;
  initialFilter?: string;
}

const CALL_STATUS_CONFIG: Record<CallStatus, { label: string; bg: string; text: string; border: string; icon: React.ElementType }> = {
  incoming: { label: 'Incoming Active', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200', icon: PhoneIncoming },
  completed: { label: 'Completed Order', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', icon: CheckCircle },
  abandoned: { label: 'Abandoned Call', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', icon: PhoneOff },
  failed: { label: 'Failed Interaction', bg: 'bg-rose-50', text: 'text-rose-800', border: 'border-rose-200', icon: AlertTriangle },
};

const SENTIMENT_CONFIG = {
  positive: { label: 'Satisfied / Positive', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  neutral: { label: 'Neutral Tone', bg: 'bg-slate-100 text-slate-700 border-slate-200' },
  frustrated: { label: 'Frustrated', bg: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export const CallHistoryView: React.FC<Props> = ({
  calls,
  loading,
  onRefresh,
  onOpenSimulateModal,
  onSelectOrderById,
  initialFilter,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>(initialFilter || 'All');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCalls = calls.filter(call => {
    const matchesStatus = filterStatus === 'All' || call.status.toLowerCase() === filterStatus.toLowerCase();
    const matchesSearch = 
      call.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      call.caller_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      call.caller_phone.includes(searchTerm) ||
      call.transcript_summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (call.order_id && call.order_id.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  // KPI Calculations
  const incomingCount = calls.filter(c => c.status === 'incoming').length;
  const completedCount = calls.filter(c => c.status === 'completed').length;
  const abandonedCount = calls.filter(c => c.status === 'abandoned').length;
  const failedCount = calls.filter(c => c.status === 'failed').length;
  const totalCalls = calls.length;
  const conversionRate = totalCalls > 0 ? ((completedCount / totalCalls) * 100).toFixed(0) : '0';

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  return (
    <div className="space-y-6">
      {/* Header and Call Simulation Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">AI Phone Call Intelligence</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time tracking for incoming calls, completed orders, abandoned calls, and failed interactions
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefresh}
            title="Refresh Calls"
            className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-orange-600' : ''}`} />
          </button>
          <button
            onClick={onOpenSimulateModal}
            className="px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold text-xs transition shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Simulate Call Interaction</span>
          </button>
        </div>
      </div>

      {/* 4 Core Required Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Incoming Calls */}
        <div 
          onClick={() => setFilterStatus('incoming')}
          className={`p-4 rounded-xl border transition cursor-pointer shadow-subtle ${
            filterStatus === 'incoming' ? 'bg-amber-50/90 border-amber-300 ring-2 ring-amber-400' : 'bg-white border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-amber-900">Incoming Calls</span>
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-800">
              <PhoneIncoming className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-amber-950 mt-1.5">{incomingCount}</p>
          <p className="text-[11px] text-amber-700 mt-1">Live active calls</p>
        </div>

        {/* Completed Orders */}
        <div 
          onClick={() => setFilterStatus('completed')}
          className={`p-4 rounded-xl border transition cursor-pointer shadow-subtle ${
            filterStatus === 'completed' ? 'bg-emerald-50/90 border-emerald-300 ring-2 ring-emerald-400' : 'bg-white border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-emerald-900">Completed Orders</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-800">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-emerald-950 mt-1.5">{completedCount}</p>
          <p className="text-[11px] text-emerald-700 mt-1">{conversionRate}% converted to sales</p>
        </div>

        {/* Abandoned Calls */}
        <div 
          onClick={() => setFilterStatus('abandoned')}
          className={`p-4 rounded-xl border transition cursor-pointer shadow-subtle ${
            filterStatus === 'abandoned' ? 'bg-slate-100 border-slate-400 ring-2 ring-slate-400' : 'bg-white border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-slate-700">Abandoned Calls</span>
            <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center text-slate-600">
              <PhoneOff className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-slate-900 mt-1.5">{abandonedCount}</p>
          <p className="text-[11px] text-slate-500 mt-1">Hung up before checkout</p>
        </div>

        {/* Failed Interactions */}
        <div 
          onClick={() => setFilterStatus('failed')}
          className={`p-4 rounded-xl border transition cursor-pointer shadow-subtle ${
            filterStatus === 'failed' ? 'bg-rose-50/90 border-rose-300 ring-2 ring-rose-400' : 'bg-white border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-rose-900">Failed Interactions</span>
            <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center text-rose-800">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-rose-950 mt-1.5">{failedCount}</p>
          <p className="text-[11px] text-rose-700 mt-1">Audio drop or payment failure</p>
        </div>
      </div>

      {/* Filter Tabs and Search Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-subtle flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          <span className="text-xs font-semibold text-slate-500 px-2 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Filter:
          </span>
          {[
            { id: 'All', label: 'All Interactions', count: calls.length },
            { id: 'incoming', label: 'Incoming', count: incomingCount },
            { id: 'completed', label: 'Completed Orders', count: completedCount },
            { id: 'abandoned', label: 'Abandoned Calls', count: abandonedCount },
            { id: 'failed', label: 'Failed', count: failedCount },
          ].map(tab => {
            const isSelected = filterStatus === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setFilterStatus(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="w-full md:w-72">
          <input
            type="text"
            placeholder="Search caller, phone, transcript..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full px-3.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
          />
        </div>
      </div>

      {/* Call Records List */}
      <div className="space-y-4">
        {filteredCalls.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center shadow-subtle">
            <PhoneCall className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800">No Call Records Found</h3>
            <p className="text-xs text-slate-500 mt-1">
              There are no calls matching the filter or search keywords in SQLite database.
            </p>
          </div>
        ) : (
          filteredCalls.map(call => {
            const statusConfig = CALL_STATUS_CONFIG[call.status] || CALL_STATUS_CONFIG.completed;
            const StatusIcon = statusConfig.icon;
            const sentimentInfo = SENTIMENT_CONFIG[call.sentiment] || SENTIMENT_CONFIG.neutral;

            return (
              <div
                key={call.id}
                className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-subtle hover:shadow-card-hover transition flex flex-col md:flex-row md:items-start justify-between gap-5 hover:border-slate-300"
              >
                {/* Left: Call Meta & Caller Info */}
                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                      {call.id}
                    </span>

                    {/* Status Pill */}
                    <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}>
                      <StatusIcon className="w-3 h-3" />
                      <span>{statusConfig.label}</span>
                    </span>

                    {/* Sentiment Pill */}
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${sentimentInfo.bg}`}>
                      {sentimentInfo.label}
                    </span>

                    <span className="text-xs text-slate-400 flex items-center gap-1 ml-auto">
                      <Clock className="w-3 h-3" />
                      {call.call_time}
                    </span>
                  </div>

                  {/* Caller Contact Info */}
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-slate-900">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span>{call.caller_name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-600 font-mono">
                      <span>{call.caller_phone}</span>
                    </div>
                    <div className="flex items-center gap-1 text-slate-500">
                      <Clock className="w-3 h-3" />
                      <span>{formatDuration(call.duration_seconds)}</span>
                    </div>
                  </div>

                  {/* Transcript Summary */}
                  <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-100 space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" /> AI Assistant Interaction Summary
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      {call.transcript_summary}
                    </p>
                    {call.notes && (
                      <p className="text-[11px] text-slate-500 italic pt-1 border-t border-slate-200/60">
                        Agent Note: {call.notes}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right: Linked Order Action if Completed */}
                <div className="md:w-56 shrink-0 flex flex-col justify-between border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-5 space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Order Association
                  </span>

                  {call.order_id ? (
                    <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-emerald-950">
                        <span>Converted to Order</span>
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                      </div>
                      <p className="text-xs font-mono font-semibold text-emerald-900">
                        #{call.order_id}
                      </p>
                      {onSelectOrderById && (
                        <button
                          type="button"
                          onClick={() => onSelectOrderById(call.order_id!)}
                          className="w-full py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-semibold transition flex items-center justify-center gap-1 shadow-sm"
                        >
                          <span>Inspect Order Details</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ) : call.status === 'abandoned' ? (
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-center">
                      <p className="text-xs text-slate-600 font-medium">No order placed</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Caller dropped inquiry</p>
                    </div>
                  ) : call.status === 'failed' ? (
                    <div className="p-3 bg-rose-50 rounded-lg border border-rose-200 text-center">
                      <p className="text-xs text-rose-700 font-semibold">Interaction Failed</p>
                      <p className="text-[10px] text-rose-600 mt-0.5">Flagged for callback</p>
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-center">
                      <p className="text-xs text-amber-800 font-semibold">Live in progress</p>
                      <p className="text-[10px] text-amber-700 mt-0.5">Streaming conversation</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
