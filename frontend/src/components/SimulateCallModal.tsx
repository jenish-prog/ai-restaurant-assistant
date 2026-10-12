import React, { useState } from 'react';
import type { CallRecordCreate, CallStatus, CallSentiment } from '../types';
import { X, PhoneCall, User, Phone, Clock, FileText } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (callData: CallRecordCreate) => Promise<void>;
}

export const SimulateCallModal: React.FC<Props> = ({ isOpen, onClose, onSubmit }) => {
  const [callerName, setCallerName] = useState('Alexander Wright');
  const [callerPhone, setCallerPhone] = useState('+1 (555) 789-0123');
  const [duration, setDuration] = useState('85');
  const [status, setStatus] = useState<CallStatus>('completed');
  const [sentiment, setSentiment] = useState<CallSentiment>('positive');
  const [transcript, setTranscript] = useState('Caller requested table reservation for 4 and inquired about dairy-free pasta alternatives.');
  const [orderId, setOrderId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await onSubmit({
        caller_name: callerName.trim() || 'Anonymous',
        caller_phone: callerPhone.trim(),
        duration_seconds: parseInt(duration, 10) || 0,
        status,
        sentiment,
        transcript_summary: transcript.trim(),
        order_id: orderId.trim() || undefined,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg flex flex-col overflow-hidden text-slate-900">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-md">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Simulate Call Event</h2>
              <p className="text-xs text-slate-300">Logs record to SQLite calls table</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-slate-400" /> Caller Name
              </label>
              <input
                type="text"
                value={callerName}
                onChange={e => setCallerName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-slate-900 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-slate-400" /> Caller Phone
              </label>
              <input
                type="tel"
                value={callerPhone}
                onChange={e => setCallerPhone(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 text-xs font-mono focus:ring-2 focus:ring-slate-900 focus:bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Call Interaction Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as CallStatus)}
                className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 text-xs font-medium focus:ring-2 focus:ring-slate-900 focus:bg-white"
              >
                <option value="incoming">Incoming (Active)</option>
                <option value="completed">Completed Order</option>
                <option value="abandoned">Abandoned Call</option>
                <option value="failed">Failed Interaction</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" /> Duration (seconds)
              </label>
              <input
                type="number"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-slate-900 focus:bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Caller Sentiment</label>
              <select
                value={sentiment}
                onChange={e => setSentiment(e.target.value as CallSentiment)}
                className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-slate-900 focus:bg-white"
              >
                <option value="positive">Positive</option>
                <option value="neutral">Neutral</option>
                <option value="frustrated">Frustrated</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Linked Order ID (Optional)</label>
              <input
                type="text"
                placeholder="e.g. ORD-101"
                value={orderId}
                onChange={e => setOrderId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 text-xs font-mono focus:ring-2 focus:ring-slate-900 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-slate-400" /> AI Transcript Summary
            </label>
            <textarea
              rows={3}
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-slate-900 focus:bg-white"
            />
          </div>

          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold text-xs shadow-sm"
            >
              {isSubmitting ? 'Writing to DB...' : 'Log Call Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
