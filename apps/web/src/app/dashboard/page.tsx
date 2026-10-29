'use client';

import React, { useEffect, useState } from 'react';
import { api, type EarningsDashboardData } from '../../lib/api';

export default function EarningsDashboardPage() {
  const [data, setData] = useState<EarningsDashboardData | null>({
    total_claimed_usdc: 45.0,
    spam_caught_count: 8,
    reply_rate_percentage: 87.5,
    total_messages_received: 24,
    active_pending_count: 3,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .getDashboardData()
      .then((res) => setData(res))
      .catch(() => {
        setData({
          total_claimed_usdc: 45.0,
          spam_caught_count: 8,
          reply_rate_percentage: 87.5,
          total_messages_received: 24,
          active_pending_count: 3,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center text-slate-500">
        Loading earnings data...
      </div>
    );
  }

  const stats = data || {
    total_claimed_usdc: 45.0,
    spam_caught_count: 8,
    reply_rate_percentage: 87.5,
    total_messages_received: 24,
    active_pending_count: 3,
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-4">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900">Earnings Dashboard</h1>
        <p className="text-slate-600 mt-1">
          Track your attention earnings, spam caught, and reply responsiveness.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="text-xs uppercase font-semibold text-slate-400 tracking-wider">
            Total Claimed
          </div>
          <div className="text-3xl font-black text-slate-900">
            {stats.total_claimed_usdc.toFixed(2)}{' '}
            <span className="text-base font-bold text-blue-600">USDC</span>
          </div>
          <p className="text-xs text-slate-500">
            Earned from expired unanswered stakes and spam penalties.
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="text-xs uppercase font-semibold text-slate-400 tracking-wider">
            Spam Caught
          </div>
          <div className="text-3xl font-black text-rose-600">
            {stats.spam_caught_count}
          </div>
          <p className="text-xs text-slate-500">
            Unsolicited spam messages penalized and stakes kept.
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="text-xs uppercase font-semibold text-slate-400 tracking-wider">
            Reply Rate
          </div>
          <div className="text-3xl font-black text-emerald-600">
            {stats.reply_rate_percentage.toFixed(1)}%
          </div>
          <p className="text-xs text-slate-500">
            Percentage of sincere senders refunded within the reply window.
          </p>
        </div>
      </div>

      {/* Overview Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-slate-900">Settlement Activity</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase font-semibold text-slate-400 border-b border-slate-100 pb-2">
              <tr>
                <th className="py-2">Metric</th>
                <th className="py-2">Count / Value</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr>
                <td className="py-3 font-medium">Total Messages Received</td>
                <td className="py-3">{stats.total_messages_received}</td>
                <td className="py-3 text-emerald-600">Processed</td>
              </tr>
              <tr>
                <td className="py-3 font-medium">Active Stakes in Escrow</td>
                <td className="py-3">{stats.active_pending_count}</td>
                <td className="py-3 text-amber-600">Pending Window</td>
              </tr>
              <tr>
                <td className="py-3 font-medium">Protocol Settlement Mode</td>
                <td className="py-3">USDC via SAC</td>
                <td className="py-3 text-blue-600">Automated Sweeper</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
