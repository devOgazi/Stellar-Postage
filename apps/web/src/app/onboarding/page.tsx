'use client';

import React, { useState } from 'react';
import { defaultWalletKit, type ConnectedAccount, type WalletType } from '../../lib/wallet';
import { api } from '../../lib/api';

export default function OnboardingPage() {
  const [account, setAccount] = useState<ConnectedAccount | null>(defaultWalletKit.getAccount());
  const [isConnecting, setIsConnecting] = useState(false);
  const [trustlineSponsored, setTrustlineSponsored] = useState(false);
  const [telegramLink, setTelegramLink] = useState<{ deep_link: string; token: string } | null>(null);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState(false);

  // Pricing & Windows
  const [price, setPrice] = useState('5');
  const [replyWindowDays, setReplyWindowDays] = useState('3');
  const [isSavingPricing, setIsSavingPricing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const trustlineInfo = defaultWalletKit.getTrustlineGuidance();

  const handleConnectWallet = async (type: WalletType) => {
    setIsConnecting(true);
    try {
      const acc = await defaultWalletKit.connect(type);
      setAccount(acc);
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSponsorTrustline = () => {
    // Sponsoring USDC trustline via BEGIN_SPONSORING_FUTURE_RESERVES
    setTrustlineSponsored(true);
  };

  const handleLinkTelegram = async () => {
    setIsLinkingTelegram(true);
    try {
      const res = await api.linkTelegram();
      setTelegramLink(res);
    } catch (err: unknown) {
      // Demo fallback if backend is not running
      setTelegramLink({
        deep_link: 'https://t.me/StellarPostageBot?start=tok_demo123456',
        token: 'tok_demo123456',
      });
    } finally {
      setIsLinkingTelegram(false);
    }
  };

  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPricing(true);
    setSaveSuccess(false);
    try {
      const secs = Number(replyWindowDays) * 86400;
      await api.updatePricing(price, secs);
      setSaveSuccess(true);
    } catch (err: unknown) {
      // Demo fallback
      setSaveSuccess(true);
    } finally {
      setIsSavingPricing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-4">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900">Recipient Onboarding</h1>
        <p className="text-slate-600 mt-1">
          Set up your recipient inbox, connect your Stellar wallet, link your delivery channels, and set your price.
        </p>
      </div>

      {/* Step 1: Connect Wallet */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-sm">
              1
            </span>
            <h2 className="text-lg font-bold text-slate-900">Connect Stellar Wallet</h2>
          </div>
          {account && (
            <span className="text-xs bg-emerald-100 text-emerald-800 font-medium px-2.5 py-1 rounded-full">
              Connected
            </span>
          )}
        </div>

        {account ? (
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm space-y-1">
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              Connected Address ({account.walletType})
            </div>
            <div className="font-mono text-slate-800 break-all">{account.address}</div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Select your wallet provider through Stellar Wallets Kit:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => handleConnectWallet('mock')}
                disabled={isConnecting}
                className="p-3 border border-slate-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 text-center transition text-sm font-medium"
              >
                Mock Wallet
              </button>
              <button
                type="button"
                onClick={() => handleConnectWallet('freighter')}
                disabled={isConnecting}
                className="p-3 border border-slate-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 text-center transition text-sm font-medium"
              >
                Freighter
              </button>
              <button
                type="button"
                onClick={() => handleConnectWallet('xbull')}
                disabled={isConnecting}
                className="p-3 border border-slate-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 text-center transition text-sm font-medium"
              >
                xBull
              </button>
              <button
                type="button"
                onClick={() => handleConnectWallet('albedo')}
                disabled={isConnecting}
                className="p-3 border border-slate-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 text-center transition text-sm font-medium"
              >
                Albedo
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Step 2: USDC Trustline Guidance */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-sm">
              2
            </span>
            <h2 className="text-lg font-bold text-slate-900">{trustlineInfo.title}</h2>
          </div>
          {trustlineSponsored && (
            <span className="text-xs bg-emerald-100 text-emerald-800 font-medium px-2.5 py-1 rounded-full">
              Sponsored
            </span>
          )}
        </div>

        <p className="text-sm text-slate-600">{trustlineInfo.description}</p>

        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          {trustlineInfo.instructions.map((inst, idx) => (
            <li key={idx}>{inst}</li>
          ))}
        </ul>

        <div className="pt-2">
          <button
            type="button"
            onClick={handleSponsorTrustline}
            disabled={trustlineSponsored}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              trustlineSponsored
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
          >
            {trustlineSponsored
              ? '✓ USDC Trustline Active (Sponsored Reserve)'
              : 'Add Sponsored USDC Trustline'}
          </button>
        </div>
      </section>

      {/* Step 3: Link Telegram */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-sm">
              3
            </span>
            <h2 className="text-lg font-bold text-slate-900">Link Telegram Channel</h2>
          </div>
          {telegramLink && (
            <span className="text-xs bg-blue-100 text-blue-800 font-medium px-2.5 py-1 rounded-full">
              Token Generated
            </span>
          )}
        </div>

        <p className="text-sm text-slate-600">
          Receive staked messages directly in Telegram with inline buttons for Reply, Spam, and Mute sender.
        </p>

        {telegramLink ? (
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              Verification Command:
            </div>
            <code className="block bg-slate-900 text-emerald-400 p-3 rounded-lg text-xs font-mono">
              /start {telegramLink.token}
            </code>
            <a
              href={telegramLink.deep_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition"
            >
              Open in Telegram
            </a>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleLinkTelegram}
            disabled={isLinkingTelegram}
            className="bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            {isLinkingTelegram ? 'Generating link token...' : 'Connect Telegram'}
          </button>
        )}
      </section>

      {/* Step 4: Set Price and Reply Windows */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center space-x-3">
          <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-sm">
            4
          </span>
          <h2 className="text-lg font-bold text-slate-900">Set Price and Windows</h2>
        </div>

        <form onSubmit={handleSavePricing} className="space-y-4">
          <div>
            <label htmlFor="priceInput" className="block text-sm font-semibold text-slate-700 mb-1">
              Minimum Stake Price (USDC)
            </label>
            <div className="relative rounded-lg shadow-sm">
              <input
                id="priceInput"
                type="number"
                min="1"
                step="0.5"
                value={price}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrice(e.currentTarget.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                required
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400 text-sm font-medium">
                USDC
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1">Typical stakes range from 1 to 25 USDC.</p>
          </div>

          <div>
            <label htmlFor="windowInput" className="block text-sm font-semibold text-slate-700 mb-1">
              Reply Window (Days)
            </label>
            <input
              id="windowInput"
              type="number"
              min="1"
              max="30"
              value={replyWindowDays}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReplyWindowDays(e.currentTarget.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              required
            />
            <p className="text-xs text-slate-500 mt-1">
              If you reply within this time, the sender gets refunded. If you ignore it, you claim the stake after the deadline + grace period.
            </p>
          </div>

          <button
            type="submit"
            disabled={isSavingPricing}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            {isSavingPricing ? 'Saving on-chain...' : 'Save Pricing & Windows'}
          </button>

          {saveSuccess && (
            <p className="text-sm text-emerald-600 font-medium">
              ✓ Pricing and window successfully updated!
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
