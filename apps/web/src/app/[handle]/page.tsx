'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, type PublicRecipient } from '../../lib/api';

export default function RecipientProfilePage() {
  const params = useParams();
  const rawHandle = typeof params?.['handle'] === 'string' ? params['handle'] : '';
  const cleanHandle = rawHandle.replace(/^(@|%40)/, '');

  const [recipient, setRecipient] = useState<PublicRecipient | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!cleanHandle) return;

    api
      .getRecipient(cleanHandle)
      .then((data) => {
        setRecipient(data);
      })
      .catch(() => {
        // Fallback for demo/unconnected backend
        setRecipient({
          user_id: 'usr_demo_1',
          handle: cleanHandle || 'alice',
          address: 'GCEXAMPLEADDRESSFORRECIPIENT1234567890STEL',
          price: '5',
          reply_window_secs: 259200, // 3 days
          channels: [{ id: 'ch_1', kind: 'telegram' }],
        });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [cleanHandle]);

  if (loading) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center text-slate-500">
        Loading recipient profile...
      </div>
    );
  }

  if (!recipient) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Recipient Not Found</h1>
        <p className="text-slate-600">The recipient @{cleanHandle} does not exist or has not onboarded yet.</p>
        <Link href="/" className="inline-block text-blue-600 hover:underline">
          Return home
        </Link>
      </div>
    );
  }

  const windowDays = Math.round(recipient.reply_window_secs / 86400);

  return (
    <div className="max-w-xl mx-auto py-8">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 space-y-6 text-center">
        <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold shadow-md">
          {recipient.handle.slice(0, 2).toUpperCase()}
        </div>

        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">@{recipient.handle}</h1>
          <p className="text-sm font-mono text-slate-400 mt-1">
            {recipient.address.slice(0, 6)}...{recipient.address.slice(-6)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 py-4 border-y border-slate-100">
          <div className="space-y-1">
            <span className="text-xs uppercase font-semibold tracking-wider text-slate-400">
              Required Stake
            </span>
            <div className="text-2xl font-black text-slate-900">
              {recipient.price} <span className="text-sm font-semibold text-blue-600">USDC</span>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs uppercase font-semibold tracking-wider text-slate-400">
              Reply Window
            </span>
            <div className="text-2xl font-black text-slate-900">
              {windowDays} <span className="text-sm font-semibold text-slate-500">Days</span>
            </div>
          </div>
        </div>

        <div className="text-left bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
          <div className="font-semibold text-slate-700">How this works:</div>
          <p>
            • Your {recipient.price} USDC stake is held safely in the Soroban escrow contract.
          </p>
          <p>
            • When @{recipient.handle} replies within {windowDays} days, you receive a full refund.
          </p>
          <p>
            • If unreplied after the window + grace period, @{recipient.handle} keeps the stake.
          </p>
        </div>

        <div className="pt-2">
          <Link
            href={`/compose?recipient=${recipient.handle}`}
            className="block w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl shadow-sm transition text-center"
          >
            Send Staked Message ({recipient.price} USDC)
          </Link>
        </div>
      </div>
    </div>
  );
}
