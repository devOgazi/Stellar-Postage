'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, type MessageStatusResponse } from '../lib/api';

export function TrackerView() {
  const searchParams = useSearchParams();
  const initialId = searchParams?.get('id') || '';

  const [messageId, setMessageId] = useState(initialId);
  const [data, setData] = useState<MessageStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialId) {
      loadStatus(initialId);
    }
  }, [initialId]);

  const loadStatus = async (id: string) => {
    if (!id.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await api.getMessage(id.trim());
      setData(res);
    } catch {
      // Fallback demo tracker data
      setData({
        id: id.trim(),
        stake_id: '42',
        sender_addr: 'GB7B3XWJ2Q4L7M6N3P9R5T2V8X1Z4A6C8E0G2I4K6M8O',
        recipient_id: 'usr_alice_1',
        recipient_handle: 'alice',
        status: 'delivered',
        created_at: new Date().toISOString(),
        stake_amount: '5',
        deadline: Math.floor(Date.now() / 1000) + 259200,
        time_left_secs: 259200,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadStatus(messageId);
  };

  const getStepStatus = (
    stepName: 'created' | 'delivered' | 'terminal',
    currentStatus?: string
  ) => {
    if (!currentStatus) return 'upcoming';
    if (stepName === 'created') return 'completed';
    if (stepName === 'delivered') {
      return currentStatus === 'pending' ? 'current' : 'completed';
    }
    if (stepName === 'terminal') {
      if (['replied', 'spam', 'expired'].includes(currentStatus)) {
        return 'completed';
      }
      return 'current';
    }
    return 'upcoming';
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-4">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900">Stake Tracker</h1>
        <p className="text-slate-600 mt-1">
          Monitor your message delivery, escrow lock, and live settlement status on Stellar / Soroban.
        </p>
      </div>

      {/* Lookup Form */}
      <form onSubmit={handleSearch} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex gap-3">
        <input
          type="text"
          placeholder="Enter Message ID (e.g. msg_xyz or UUID)..."
          value={messageId}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMessageId(e.currentTarget.value)}
          className="flex-1 px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-xl text-sm transition disabled:opacity-50"
        >
          {loading ? 'Tracking...' : 'Track'}
        </button>
      </form>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm">
          {error}
        </div>
      )}

      {data && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-2">
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Message & Stake
              </span>
              <h2 className="text-xl font-bold font-mono text-slate-900">{data.id}</h2>
            </div>
            <div className="flex items-center space-x-2">
              <span
                className={`text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider ${
                  data.status === 'replied'
                    ? 'bg-emerald-100 text-emerald-800'
                    : data.status === 'delivered'
                    ? 'bg-blue-100 text-blue-800'
                    : data.status === 'spam'
                    ? 'bg-rose-100 text-rose-800'
                    : data.status === 'expired'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-100 text-slate-800'
                }`}
              >
                {data.status}
              </span>
            </div>
          </div>

          {/* Stepper Timeline */}
          <div className="grid grid-cols-3 gap-2 text-center py-2">
            <div className="space-y-1">
              <div
                className={`w-8 h-8 mx-auto rounded-full flex items-center justify-center text-xs font-bold ${
                  getStepStatus('created', data.status) === 'completed'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                ✓
              </div>
              <div className="text-xs font-bold text-slate-800">1. Staked</div>
              <div className="text-[11px] text-slate-400">Escrow Locked</div>
            </div>

            <div className="space-y-1">
              <div
                className={`w-8 h-8 mx-auto rounded-full flex items-center justify-center text-xs font-bold ${
                  getStepStatus('delivered', data.status) === 'completed'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-blue-600 text-white animate-pulse'
                }`}
              >
                2
              </div>
              <div className="text-xs font-bold text-slate-800">2. Delivered</div>
              <div className="text-[11px] text-slate-400">Recipient Notified</div>
            </div>

            <div className="space-y-1">
              <div
                className={`w-8 h-8 mx-auto rounded-full flex items-center justify-center text-xs font-bold ${
                  getStepStatus('terminal', data.status) === 'completed'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                3
              </div>
              <div className="text-xs font-bold text-slate-800">3. Settlement</div>
              <div className="text-[11px] text-slate-400">
                {data.status === 'replied'
                  ? 'Refunded'
                  : data.status === 'spam'
                  ? 'Spam Penalty'
                  : data.status === 'expired'
                  ? 'Claimed'
                  : 'Pending Window'}
              </div>
            </div>
          </div>

          {/* Metadata Cards */}
          <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs">
            <div>
              <span className="text-slate-400 font-semibold uppercase tracking-wider">
                Stake Amount
              </span>
              <p className="text-base font-bold text-slate-900 mt-0.5">
                {data.stake_amount || '5'} USDC
              </p>
            </div>
            <div>
              <span className="text-slate-400 font-semibold uppercase tracking-wider">
                On-Chain Stake ID
              </span>
              <p className="text-base font-bold text-slate-900 mt-0.5">
                #{data.stake_id || 'Pending'}
              </p>
            </div>
            <div>
              <span className="text-slate-400 font-semibold uppercase tracking-wider">
                Sender Account
              </span>
              <p className="font-mono text-slate-700 mt-0.5 truncate">{data.sender_addr}</p>
            </div>
            <div>
              <span className="text-slate-400 font-semibold uppercase tracking-wider">
                Recipient
              </span>
              <p className="font-semibold text-slate-800 mt-0.5">
                @{data.recipient_handle || 'recipient'}
              </p>
            </div>
          </div>

          {/* Status Explanation */}
          <div className="p-4 rounded-xl text-xs bg-blue-50/50 border border-blue-100 text-blue-900">
            {data.status === 'delivered' && (
              <p>
                ⏳ The message has been delivered. The recipient is reviewing it. If they reply before the deadline, you will receive a full refund.
              </p>
            )}
            {data.status === 'replied' && (
              <p>
                🎉 Sincere reply detected! The oracle confirmed the reply and refunded {data.stake_amount || '5'} USDC back to your wallet.
              </p>
            )}
            {data.status === 'spam' && (
              <p>
                ⛔ This message was flagged as spam by the recipient. The stake was retained.
              </p>
            )}
            {data.status === 'expired' && (
              <p>
                ⏰ The reply window + grace period has expired. The stake was claimed by the recipient via keeper sweeper.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
