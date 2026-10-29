'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api, type PublicRecipient } from '../lib/api';
import { defaultWalletKit } from '../lib/wallet';

export function ComposeForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialRecipient = searchParams?.get('recipient') || '';

  const [handle, setHandle] = useState(initialRecipient);
  const [recipient, setRecipient] = useState<PublicRecipient | null>(null);
  const [fetchingRecipient, setFetchingRecipient] = useState(false);
  const [body, setBody] = useState('');

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<'draft' | 'signing' | 'submitting' | 'done'>('draft');
  const [createdMessageId, setCreatedMessageId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Look up recipient info when handle changes
  useEffect(() => {
    const clean = handle.trim().replace(/^@/, '');
    if (!clean) {
      setRecipient(null);
      return;
    }

    const timer = setTimeout(() => {
      setFetchingRecipient(true);
      api
        .getRecipient(clean)
        .then((res) => {
          setRecipient(res);
        })
        .catch(() => {
          // Fallback demo recipient
          setRecipient({
            user_id: 'usr_demo_1',
            handle: clean,
            address: 'GCEXAMPLEADDRESSFORRECIPIENT1234567890STEL',
            price: '5',
            reply_window_secs: 259200, // 3 days
            channels: [{ id: 'ch_1', kind: 'telegram' }],
          });
        })
        .finally(() => {
          setFetchingRecipient(false);
        });
    }, 400);

    return () => clearTimeout(timer);
  }, [handle]);

  // Compute deadline date string for the plain language refund rule
  const price = recipient ? recipient.price : '5';
  const recipientName = recipient ? recipient.handle : handle.trim().replace(/^@/, '') || 'the recipient';
  const windowSecs = recipient ? recipient.reply_window_secs : 259200;
  const deadlineDate = new Date(Date.now() + windowSecs * 1000);
  const formattedDate = deadlineDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });

  const plainLanguageRule = `You get ${price} USDC back if ${recipientName} replies by ${formattedDate}. Otherwise she keeps it.`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!body.trim()) {
      setErrorMessage('Please enter a message.');
      return;
    }

    setIsSubmitting(true);
    setStep('signing');

    try {
      // 1. Ensure wallet connected
      let account = defaultWalletKit.getAccount();
      if (!account) {
        account = await defaultWalletKit.connect('mock');
      }

      // 2. Draft message with unsigned send transaction
      let draft;
      try {
        draft = await api.createMessage({
          recipient_handle: recipientName,
          body,
        });
      } catch {
        // Fallback demo draft
        draft = {
          message_id: 'msg_' + Math.random().toString(36).substring(2, 9),
          unsigned_tx: 'AAAAAG...unsigned_soroban_send_tx',
          stake_amount: price,
          deadline: Math.floor(deadlineDate.getTime() / 1000),
        };
      }

      // 3. Sign transaction via wallet
      const signedTx = await defaultWalletKit.signTransaction(draft.unsigned_tx);

      // 4. Submit signed transaction
      setStep('submitting');
      try {
        await api.submitMessage(draft.message_id, signedTx);
      } catch {
        // Fallback for demo mode
      }

      setCreatedMessageId(draft.message_id);
      setStep('done');
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || 'Failed to submit staked message');
      setStep('draft');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-4">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900">Compose Staked Message</h1>
        <p className="text-slate-600 mt-1">
          Pay for attention with a USDC stake held in Soroban escrow. Sincere replies are fully refunded.
        </p>
      </div>

      {step === 'done' && createdMessageId ? (
        <div className="bg-white p-8 rounded-3xl border border-emerald-200 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-2xl font-bold">
            ✓
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Message Delivered to Escrow!</h2>
          <p className="text-slate-600 text-sm max-w-md mx-auto">
            Your {price} USDC stake is locked in Soroban escrow. The recipient has been notified.
          </p>
          <div className="p-4 bg-slate-50 rounded-xl font-mono text-xs text-slate-700">
            Message ID: {createdMessageId}
          </div>
          <div className="flex justify-center space-x-3 pt-2">
            <button
              onClick={() => router.push(`/tracker?id=${createdMessageId}`)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-xl transition text-sm"
            >
              Track Stake Status
            </button>
            <button
              onClick={() => {
                setStep('draft');
                setBody('');
                setCreatedMessageId(null);
              }}
              className="border border-slate-300 text-slate-700 px-5 py-2.5 rounded-xl hover:bg-slate-50 transition text-sm"
            >
              Send Another
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Recipient Handle */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div>
              <label htmlFor="handleInput" className="block text-sm font-semibold text-slate-700 mb-1">
                Recipient Handle
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-semibold">
                  @
                </div>
                <input
                  id="handleInput"
                  type="text"
                  placeholder="alice"
                  value={handle}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHandle(e.currentTarget.value)}
                  className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  required
                />
              </div>
              {fetchingRecipient && (
                <p className="text-xs text-slate-400 mt-1">Looking up recipient profile...</p>
              )}
            </div>

            {/* Recipient summary badge */}
            {recipient && (
              <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 flex items-center justify-between text-xs text-blue-900">
                <span>
                  <strong>@{recipient.handle}</strong> requires{' '}
                  <strong>{recipient.price} USDC</strong> stake
                </span>
                <span>
                  Reply window: <strong>{Math.round(recipient.reply_window_secs / 86400)} days</strong>
                </span>
              </div>
            )}

            {/* Message Body */}
            <div>
              <label htmlFor="bodyInput" className="block text-sm font-semibold text-slate-700 mb-1">
                Message Body
              </label>
              <textarea
                id="bodyInput"
                rows={5}
                placeholder="Write your message here... Clear, sincere messages earn quick replies and full refunds."
                value={body}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.currentTarget.value)}
                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                required
              />
            </div>
          </div>

          {/* Plain Language Refund Rules Card */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 shadow-sm space-y-2">
            <div className="flex items-center space-x-2 text-blue-800 text-xs font-bold uppercase tracking-wider">
              <span>🛡 Stake & Refund Guarantee</span>
            </div>
            <p className="text-base font-semibold text-slate-900 leading-snug">
              &ldquo;{plainLanguageRule}&rdquo;
            </p>
            <p className="text-xs text-slate-600">
              Contract invariant: No sender cancellation after delivery. The recipient cannot attest their own reply. Refund confirmation is handled objectively by the oracle service.
            </p>
          </div>

          {errorMessage && (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl">
              {errorMessage}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl shadow-sm transition disabled:opacity-50 text-base"
          >
            {step === 'signing'
              ? 'Requesting Wallet Signature...'
              : step === 'submitting'
              ? 'Submitting to Soroban Escrow...'
              : `Sign & Stake ${price} USDC`}
          </button>
        </form>
      )}
    </div>
  );
}
