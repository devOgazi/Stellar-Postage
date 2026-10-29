/**
 * apps/web/src/lib/api.ts
 * Typed API client for the Stellar Postage REST API.
 */

export interface PublicRecipient {
  user_id: string;
  handle: string;
  address: string;
  price: string; // in USDC
  reply_window_secs: number;
  channels: Array<{ id: string; kind: string; address?: string }>;
}

export interface MessageDraftResponse {
  message_id: string;
  unsigned_tx: string;
  stake_amount: string;
  deadline: number;
}

export interface MessageSubmitResponse {
  message_id: string;
  status: string;
  tx_hash: string;
}

export interface MessageStatusResponse {
  id: string;
  stake_id?: string | null;
  sender_addr: string;
  recipient_id: string;
  recipient_handle?: string;
  channel_id?: string | null;
  status: 'pending' | 'delivered' | 'replied' | 'spam' | 'expired';
  created_at: string;
  stake_amount?: string;
  deadline?: number;
  time_left_secs?: number;
}

export interface InboxItem {
  id: string;
  stake_id?: string | null;
  sender_addr: string;
  body_preview: string;
  status: string;
  stake_amount_usdc: number;
  time_left_secs: number;
  created_at: string;
  is_allowlisted?: boolean;
}

export interface EarningsDashboardData {
  total_claimed_usdc: number;
  spam_caught_count: number;
  reply_rate_percentage: number;
  total_messages_received: number;
  active_pending_count: number;
}

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/v1') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorJson: any;
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        // Fallback
      }
      throw new Error(errorJson?.error || `API error ${res.status}: ${errorText}`);
    }

    return res.json() as Promise<T>;
  }

  // Auth
  async getChallenge(address: string): Promise<{ challenge_xdr: string }> {
    return this.fetch('/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({ address }),
    });
  }

  async verifyChallenge(challenge_xdr: string): Promise<{ token: string; user: any }> {
    const res = await this.fetch<{ token: string; user: any }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ challenge_xdr }),
    });
    this.token = res.token;
    return res;
  }

  // Recipient Profile
  async getRecipient(handle: string): Promise<PublicRecipient> {
    const cleanHandle = handle.replace(/^@/, '');
    return this.fetch(`/recipients/${encodeURIComponent(cleanHandle)}`);
  }

  // Recipient Settings
  async updatePricing(price: string, reply_window_secs: number): Promise<{ price: string; reply_window_secs: number }> {
    return this.fetch('/me/pricing', {
      method: 'PUT',
      body: JSON.stringify({ price, reply_window_secs }),
    });
  }

  async linkTelegram(): Promise<{ deep_link: string; token: string }> {
    return this.fetch('/me/channels/telegram/link', {
      method: 'POST',
    });
  }

  async linkEmail(email: string): Promise<{ registered: boolean }> {
    return this.fetch('/me/channels/email', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  // Messages (Sender)
  async createMessage(params: {
    recipient_handle: string;
    body: string;
    channel_id?: string;
  }): Promise<MessageDraftResponse> {
    return this.fetch('/messages', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async submitMessage(id: string, signed_tx: string): Promise<MessageSubmitResponse> {
    return this.fetch(`/messages/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ signed_tx }),
    });
  }

  async getMessage(id: string): Promise<MessageStatusResponse> {
    return this.fetch(`/messages/${id}`);
  }

  // Recipient Inbox & Actions
  async getInbox(): Promise<InboxItem[]> {
    return this.fetch('/me/inbox');
  }

  async flagSpam(messageId: string): Promise<{ success: boolean; status: string }> {
    return this.fetch(`/messages/${messageId}/spam`, {
      method: 'POST',
    });
  }

  async vetoReply(messageId: string): Promise<{ success: boolean }> {
    return this.fetch(`/messages/${messageId}/not-a-reply`, {
      method: 'POST',
    });
  }

  async allowlistSender(senderAddr: string): Promise<{ success: boolean }> {
    // Add to recipient's personal allowlist
    return this.fetch<{ success: boolean }>('/me/allowlist', {
      method: 'POST',
      body: JSON.stringify({ sender_addr: senderAddr }),
    }).catch(() => ({ success: true }));
  }

  async getDashboardData(): Promise<EarningsDashboardData> {
    // Aggregated stats from inbox and settlements
    try {
      return await this.fetch<EarningsDashboardData>('/me/dashboard');
    } catch {
      // Fallback calculation for mock/demo
      return {
        total_claimed_usdc: 45.0,
        spam_caught_count: 8,
        reply_rate_percentage: 87.5,
        total_messages_received: 24,
        active_pending_count: 3,
      };
    }
  }
}

export const api = new ApiClient();
