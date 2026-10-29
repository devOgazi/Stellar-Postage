import './globals.css';
import type { Metadata } from 'next';
import { Navbar } from '../components/Navbar';

export const metadata: Metadata = {
  title: 'Stellar Postage – Pay-to-Reach Messaging',
  description: 'Pay-to-reach messaging on Stellar/Soroban. Senders stake USDC, recipients get paid or refund sincere replies.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex flex-col bg-slate-50 text-slate-900">
        <Navbar />
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">{children}</main>
        <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
          Stellar Postage • Powered by Soroban Smart Contracts & Stellar USDC • Zero XLM required with sponsored reserves
        </footer>
      </body>
    </html>
  );
}
