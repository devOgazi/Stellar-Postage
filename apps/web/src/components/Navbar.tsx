'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { defaultWalletKit, type ConnectedAccount } from '../lib/wallet';

export function Navbar() {
  const [account, setAccount] = useState<ConnectedAccount | null>(defaultWalletKit.getAccount());
  const [isConnecting, setIsConnecting] = useState(false);
  const [showWallets, setShowWallets] = useState(false);

  const handleConnect = async (type: 'freighter' | 'xbull' | 'albedo' | 'mock') => {
    setIsConnecting(true);
    try {
      const acc = await defaultWalletKit.connect(type);
      setAccount(acc);
      setShowWallets(false);
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    defaultWalletKit.disconnect();
    setAccount(null);
  };

  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-8">
          <Link href="/" className="flex items-center space-x-2">
            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Stellar Postage
            </span>
          </Link>
          <nav className="hidden md:flex space-x-6 text-sm font-medium text-slate-600">
            <Link href="/compose" className="hover:text-blue-600 transition">
              Compose (Sender)
            </Link>
            <Link href="/tracker" className="hover:text-blue-600 transition">
              Stake Tracker
            </Link>
            <Link href="/inbox" className="hover:text-blue-600 transition">
              Inbox (Recipient)
            </Link>
            <Link href="/dashboard" className="hover:text-blue-600 transition">
              Earnings
            </Link>
            <Link href="/onboarding" className="hover:text-blue-600 transition">
              Onboarding
            </Link>
          </nav>
        </div>

        <div className="flex items-center space-x-4">
          {account ? (
            <div className="flex items-center space-x-3 bg-slate-100 rounded-full px-3 py-1.5 border border-slate-200 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="font-mono text-slate-700">
                {account.address.slice(0, 4)}...{account.address.slice(-4)}
              </span>
              <button
                onClick={handleDisconnect}
                className="text-slate-400 hover:text-slate-600 ml-1"
                title="Disconnect"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowWallets(!showWallets)}
                disabled={isConnecting}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition disabled:opacity-50"
              >
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>

              {showWallets && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg p-2 z-50">
                  <p className="text-xs font-semibold text-slate-400 px-3 py-1 uppercase tracking-wider">
                    Stellar Wallets Kit
                  </p>
                  <button
                    onClick={() => handleConnect('mock')}
                    className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 flex items-center justify-between text-slate-700"
                  >
                    <span>Mock Wallet (Dev)</span>
                    <span className="text-xs text-blue-600 font-medium">Ready</span>
                  </button>
                  <button
                    onClick={() => handleConnect('freighter')}
                    className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 flex items-center justify-between text-slate-700"
                  >
                    <span>Freighter</span>
                    <span className="text-xs text-slate-400">Extension</span>
                  </button>
                  <button
                    onClick={() => handleConnect('xbull')}
                    className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 flex items-center justify-between text-slate-700"
                  >
                    <span>xBull</span>
                    <span className="text-xs text-slate-400">Extension</span>
                  </button>
                  <button
                    onClick={() => handleConnect('albedo')}
                    className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 flex items-center justify-between text-slate-700"
                  >
                    <span>Albedo</span>
                    <span className="text-xs text-slate-400">Web</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
