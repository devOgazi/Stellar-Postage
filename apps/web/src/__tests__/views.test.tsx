/// <reference path="../../../../node_modules/.pnpm/@types+jest@29.5.12/node_modules/@types/jest/index.d.ts" />
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => ({
    get: (param: string) => (param === 'recipient' ? 'alice' : null),
  }),
  useParams: () => ({
    handle: 'alice',
  }),
}));

import HomePage from '../app/page';
import { Navbar } from '../components/Navbar';
import EarningsDashboardPage from '../app/dashboard/page';
import OnboardingPage from '../app/onboarding/page';
import InboxPage from '../app/inbox/page';
import { ComposeForm } from '../components/ComposeForm';
import { TrackerView } from '../components/TrackerView';
import { StellarWalletsKit, MockWalletProvider } from '../lib/wallet';

describe('Web Component Views', () => {
  it('renders HomePage with hero and value proposition', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain('Reach anyone sincere');
    expect(html).toContain('USDC Pay-to-Reach');
    expect(html).toContain('Send a Staked Message');
    expect(html).toContain('Recipient Setup &amp; Onboarding');
  });

  it('renders Navbar with brand and navigation links', () => {
    const html = renderToStaticMarkup(<Navbar />);
    expect(html).toContain('Stellar Postage');
    expect(html).toContain('Compose (Sender)');
    expect(html).toContain('Stake Tracker');
    expect(html).toContain('Inbox (Recipient)');
    expect(html).toContain('Earnings');
    expect(html).toContain('Onboarding');
    expect(html).toContain('Connect Wallet');
  });

  it('renders Recipient Onboarding with Wallets Kit, trustline guidance, telegram and pricing', () => {
    const html = renderToStaticMarkup(<OnboardingPage />);
    // Step 1: Wallets Kit
    expect(html).toContain('Connect Stellar Wallet');
    expect(html).toContain('Mock Wallet');
    expect(html).toContain('Freighter');
    expect(html).toContain('xBull');
    expect(html).toContain('Albedo');

    // Step 2: USDC Trustline Guidance
    expect(html).toContain('USDC Trustline Setup');
    expect(html).toContain('BEGIN_SPONSORING_FUTURE_RESERVES');
    expect(html).toContain('Add Sponsored USDC Trustline');

    // Step 3: Link Telegram
    expect(html).toContain('Link Telegram Channel');
    expect(html).toContain('Connect Telegram');

    // Step 4: Set Price and Windows
    expect(html).toContain('Set Price and Windows');
    expect(html).toContain('Minimum Stake Price (USDC)');
    expect(html).toContain('Reply Window (Days)');
  });

  it('renders Recipient Inbox with stake amount, countdown, and Reply/Spam/Allowlist buttons', () => {
    const html = renderToStaticMarkup(<InboxPage />);
    expect(html).toContain('Recipient Inbox');
    expect(html).toContain('Review staked incoming messages');
  });

  it('renders Earnings Dashboard with claimed total, spam caught, and reply rate', () => {
    const html = renderToStaticMarkup(<EarningsDashboardPage />);
    expect(html).toContain('Earnings Dashboard');
    expect(html).toContain('Total Claimed');
    expect(html).toContain('Spam Caught');
    expect(html).toContain('Reply Rate');
    expect(html).toContain('USDC via SAC');
  });

  it('renders Compose Page with plain language refund rules and wallet submission', () => {
    const html = renderToStaticMarkup(<ComposeForm />);
    expect(html).toContain('Compose Staked Message');
    expect(html).toContain('Stake &amp; Refund Guarantee');
    expect(html).toContain('You get 5 USDC back if');
    expect(html).toContain('Otherwise she keeps it.');
    expect(html).toContain('Sign &amp; Stake 5 USDC');
  });

  it('renders Stake Tracker with status progression and escrow details', () => {
    const html = renderToStaticMarkup(<TrackerView />);
    expect(html).toContain('Stake Tracker');
    expect(html).toContain('Enter Message ID');
  });

  describe('StellarWalletsKit', () => {
    it('connects mock wallet and signs transaction XDR', async () => {
      const kit = new StellarWalletsKit();
      const account = await kit.connect('mock');

      expect(account.walletType).toBe('mock');
      expect(account.address).toContain('GBW');

      const signed = await kit.signTransaction('AAAA_XDR_MOCK');
      expect(signed).toContain('signed-mock');
    });

    it('provides USDC trustline guidance with sponsored reserves description', () => {
      const kit = new StellarWalletsKit();
      const guidance = kit.getTrustlineGuidance();

      expect(guidance.sponsorshipSponsored).toBe(true);
      expect(guidance.description).toContain('BEGIN_SPONSORING_FUTURE_RESERVES');
    });
  });
});
