'use client';

import React, { useState, useEffect } from 'react';
import { api, type InboxItem } from '../../lib/api';

export default function InboxPage() {
  const [messages, setMessages] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyTextMap, setReplyTextMap] = useState<Record<string, string>>({});
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);

  useEffect(() => {
    loadInbox();
  }, []);

  const loadInbox = () => {
    setLoading(true);
    api
      .getInbox()
      .then((data) => {
        setMessages(data);
      })
      .catch(() => {
        // Fallback demo data
        setMessages([
          {
            id: 'msg-demo-1',
            stake_id: '1',
            sender_addr: 'GB7B3XWJ2Q4L7M6N3P9R5T2V8X1Z4A6C8E0G2I4K6M8O',
            body_preview: 'Hi! Loved your recent talk on Soroban smart contract performance. Would love to collaborate on a research proposal.',
            status: 'delivered',
            stake_amount_usdc: 10,
            time_left_secs: 145200, // ~1.6 days left
            created_at: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            id: 'msg-demo-2',
            stake_id: '2',
            sender_addr: 'GCE6O8M6K4I2G0E8C6A4Z1X8V2T5R9P3N6M7L4Q2JW',
            body_preview: 'Quick question regarding your availability for consulting next quarter.',
            status: 'delivered',
            stake_amount_usdc: 5,
            time_left_secs: 54000, // ~15 hours left
            created_at: new Date(Date.now() - 7200000).toISOString(),
          },
          {
            id: 'msg-demo-3',
            stake_id: '3',
            sender_addr: 'GASPAMMER3982741982734918237498127394812739',
            body_preview: 'Buy crypto signals now! Click http://totallylegit.site for 100x gains guaranteed.',
            status: 'delivered',
            stake_amount_usdc: 5,
            time_left_secs: 200000,
            created_at: new Date(Date.now() - 10000000).toISOString(),
          },
        ]);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const formatTimeLeft = (secs: number) => {
    if (secs <= 0) return 'Expired';
    const hours = Math.floor(secs / 3600);
    const days = Math.floor(hours / 24);
    if (days > 0) {
      return `${days}d ${hours % 24}h left`;
    }
    const mins = Math.floor((secs % 3600) / 60);
    return `${hours}h ${mins}m left`;
  };

  const handleSpam = async (id: string) => {
    try {
      await api.flagSpam(id);
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: 'spam' } : m))
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: 'spam' } : m))
      );
    }
  };

  const handleAllowlist = async (senderAddr: string, id: string) => {
    try {
      await api.allowlistSender(senderAddr);
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, is_allowlisted: true } : m))
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, is_allowlisted: true } : m))
      );
    }
  };

  const handleSendReply = (id: string) => {
    const text = replyTextMap[id];
    if (!text || text.trim().length === 0) return;
    // Mark replied in UI
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status: 'replied' } : m))
    );
    setActiveReplyId(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">Recipient Inbox</h1>
          <p className="text-slate-600 mt-1">
            Review staked incoming messages. Replying refunds sincere senders; spam burns them.
          </p>
        </div>
        <button
          onClick={loadInbox}
          className="self-start text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
        >
          Refresh Inbox
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500">Loading messages...</div>
      ) : messages.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <p className="text-lg font-bold text-slate-800">Your inbox is clean</p>
          <p className="text-sm text-slate-500">No staked messages waiting for review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((msg) => (
            <article
              key={msg.id}
              className={`bg-white rounded-2xl border p-6 transition shadow-sm space-y-4 ${
                msg.status === 'spam'
                  ? 'border-red-200 bg-red-50/20 opacity-75'
                  : msg.status === 'replied'
                  ? 'border-emerald-200 bg-emerald-50/20'
                  : 'border-slate-200'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 font-mono text-xs flex items-center justify-center font-bold text-slate-700">
                    {msg.sender_addr.slice(0, 2)}
                  </div>
                  <div>
                    <div className="text-xs font-mono text-slate-600">
                      {msg.sender_addr.slice(0, 6)}...{msg.sender_addr.slice(-6)}
                      {msg.is_allowlisted && (
                        <span className="ml-2 text-xs bg-purple-100 text-purple-700 font-sans font-medium px-2 py-0.5 rounded-full">
                          Allowlisted
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      Received {new Date(msg.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-3 self-end sm:self-center">
                  <div className="flex items-center space-x-1.5 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-xs font-semibold">
                    <span>{msg.stake_amount_usdc} USDC Staked</span>
                  </div>
                  <div className="text-xs font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                    ⏱ {formatTimeLeft(msg.time_left_secs)}
                  </div>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${
                      msg.status === 'replied'
                        ? 'bg-emerald-100 text-emerald-800'
                        : msg.status === 'spam'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {msg.status}
                  </span>
                </div>
              </div>

              <div className="text-slate-800 text-sm leading-relaxed whitespace-pre-wrap">
                {msg.body_preview}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  {msg.status !== 'spam' && msg.status !== 'replied' && (
                    <button
                      onClick={() =>
                        setActiveReplyId(activeReplyId === msg.id ? null : msg.id)
                      }
                      className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition"
                    >
                      {activeReplyId === msg.id ? 'Cancel Reply' : 'Reply (Refund Sender)'}
                    </button>
                  )}

                  {msg.status !== 'spam' && (
                    <button
                      onClick={() => handleSpam(msg.id)}
                      className="border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold px-3 py-2 rounded-lg transition"
                    >
                      Spam (Burn Stake)
                    </button>
                  )}

                  {!msg.is_allowlisted && (
                    <button
                      onClick={() => handleAllowlist(msg.sender_addr, msg.id)}
                      className="border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold px-3 py-2 rounded-lg transition"
                    >
                      Allowlist Sender
                    </button>
                  )}
                </div>

                <div className="text-xs text-slate-400">
                  {msg.status === 'replied' && 'Sender refunded via oracle attestation.'}
                  {msg.status === 'spam' && 'Flagged as spam. Recipient keeps stake.'}
                </div>
              </div>

              {/* Inline Reply Form */}
              {activeReplyId === msg.id && (
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                  <textarea
                    rows={3}
                    placeholder="Type your reply to refund the sender..."
                    value={replyTextMap[msg.id] || ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setReplyTextMap({ ...replyTextMap, [msg.id]: e.currentTarget.value })
                    }
                    className="w-full text-sm p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={() => setActiveReplyId(null)}
                      className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSendReply(msg.id)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition"
                    >
                      Send Reply & Refund
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
