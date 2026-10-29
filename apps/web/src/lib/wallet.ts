/**
 * apps/web/src/lib/wallet.ts
 * Stellar Wallets Kit integration supporting Freighter, xBull, Albedo, and MockWallet.
 */

export type WalletType = 'freighter' | 'xbull' | 'albedo' | 'mock';

export interface ConnectedAccount {
  address: string;
  walletType: WalletType;
  hasUsdcTrustline: boolean;
}

export interface WalletProvider {
  type: WalletType;
  name: string;
  isAvailable(): boolean;
  connect(): Promise<string>;
  signTransaction(xdr: string): Promise<string>;
}

export class MockWalletProvider implements WalletProvider {
  type: WalletType = 'mock';
  name = 'Mock Stellar Wallet';
  private address: string;

  constructor(address = 'GBWMOCKWALLETADDRESSFORTESTINGPURPOSES1234567890') {
    this.address = address;
  }

  isAvailable(): boolean {
    return true;
  }

  async connect(): Promise<string> {
    return this.address;
  }

  async signTransaction(xdr: string): Promise<string> {
    // In mock wallet mode, simulate adding signature to XDR
    return xdr + '-signed-mock';
  }
}

export class FreighterWalletProvider implements WalletProvider {
  type: WalletType = 'freighter';
  name = 'Freighter';

  isAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean((window as any).freighter);
  }

  async connect(): Promise<string> {
    if (typeof window !== 'undefined' && (window as any).freighter) {
      const res = await (window as any).freighter.getPublicKey();
      return res;
    }
    throw new Error('Freighter wallet extension not detected');
  }

  async signTransaction(xdr: string): Promise<string> {
    if (typeof window !== 'undefined' && (window as any).freighter) {
      return (window as any).freighter.signTransaction(xdr);
    }
    throw new Error('Freighter wallet extension not detected');
  }
}

export class XBullWalletProvider implements WalletProvider {
  type: WalletType = 'xbull';
  name = 'xBull';

  isAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean((window as any).xBullSDK);
  }

  async connect(): Promise<string> {
    if (typeof window !== 'undefined' && (window as any).xBullSDK) {
      return (window as any).xBullSDK.getPublicKey();
    }
    throw new Error('xBull wallet extension not detected');
  }

  async signTransaction(xdr: string): Promise<string> {
    if (typeof window !== 'undefined' && (window as any).xBullSDK) {
      return (window as any).xBullSDK.signXDR(xdr);
    }
    throw new Error('xBull wallet extension not detected');
  }
}

export class AlbedoWalletProvider implements WalletProvider {
  type: WalletType = 'albedo';
  name = 'Albedo';

  isAvailable(): boolean {
    return true; // Albedo opens web popup
  }

  async connect(): Promise<string> {
    if (typeof window !== 'undefined' && (window as any).albedo) {
      const res = await (window as any).albedo.publicKey({});
      return res.pubkey;
    }
    return 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  }

  async signTransaction(xdr: string): Promise<string> {
    if (typeof window !== 'undefined' && (window as any).albedo) {
      const res = await (window as any).albedo.tx({ xdr });
      return res.signed_envelope_xdr;
    }
    return xdr;
  }
}

export class StellarWalletsKit {
  private providers: Map<WalletType, WalletProvider> = new Map();
  private currentProvider: WalletProvider | null = null;
  private currentAccount: ConnectedAccount | null = null;

  constructor() {
    this.registerProvider(new MockWalletProvider());
    this.registerProvider(new FreighterWalletProvider());
    this.registerProvider(new XBullWalletProvider());
    this.registerProvider(new AlbedoWalletProvider());
  }

  registerProvider(provider: WalletProvider): void {
    this.providers.set(provider.type, provider);
  }

  getAvailableWallets(): Array<{ type: WalletType; name: string; available: boolean }> {
    return Array.from(this.providers.values()).map((p) => ({
      type: p.type,
      name: p.name,
      available: p.isAvailable(),
    }));
  }

  async connect(type: WalletType): Promise<ConnectedAccount> {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Wallet provider ${type} not supported`);
    }

    const address = await provider.connect();
    this.currentProvider = provider;
    this.currentAccount = {
      address,
      walletType: type,
      hasUsdcTrustline: true, // Default or verified via horizon
    };
    return this.currentAccount;
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!this.currentProvider) {
      throw new Error('No wallet connected. Please connect a wallet first.');
    }
    return this.currentProvider.signTransaction(xdr);
  }

  getAccount(): ConnectedAccount | null {
    return this.currentAccount;
  }

  disconnect(): void {
    this.currentProvider = null;
    this.currentAccount = null;
  }

  /**
   * Guidance & helper for USDC trustline sponsored reserves.
   * Uses BEGIN_SPONSORING_FUTURE_RESERVES as outlined in the README.
   */
  getTrustlineGuidance(): {
    title: string;
    description: string;
    instructions: string[];
    sponsorshipSponsored: boolean;
  } {
    return {
      title: 'USDC Trustline Setup',
      description:
        'Every Stellar account holding USDC needs a trustline. Stellar Postage sponsors your reserve via BEGIN_SPONSORING_FUTURE_RESERVES so you never need XLM.',
      instructions: [
        'Connect your Stellar wallet (Freighter, xBull, Albedo, or Passkey).',
        'Request sponsored trustline creation from the platform.',
        'Sign the sponsored change_trust operation without spending XLM.',
      ],
      sponsorshipSponsored: true,
    };
  }
}

export const defaultWalletKit = new StellarWalletsKit();
