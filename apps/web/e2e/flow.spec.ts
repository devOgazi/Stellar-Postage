import { test, expect } from '@playwright/test';

test.describe('Stellar Postage End-to-End User Journeys', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept and mock API calls for deterministic E2E flow
    await page.route('**/v1/recipients/alice', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user_id: 'usr_alice_123',
          handle: 'alice',
          address: 'GCALICEADDRESSFORTESTINGPURPOSES1234567890STEL',
          price: '5',
          reply_window_secs: 259200, // 3 days
          channels: [{ id: 'ch_tg_1', kind: 'telegram' }],
        }),
      });
    });

    await page.route('**/v1/messages', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message_id: 'msg_e2e_test_12345',
          unsigned_tx: 'AAAAAG_MOCK_UNBOUND_SEND_TRANSACTION_XDR',
          stake_amount: '5',
          deadline: Math.floor(Date.now() / 1000) + 259200,
        }),
      });
    });

    await page.route('**/v1/messages/*/submit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message_id: 'msg_e2e_test_12345',
          status: 'delivered',
          tx_hash: 'tx_e2e_submit_hash_777',
        }),
      });
    });

    await page.route('**/v1/messages/msg_e2e_test_12345', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'msg_e2e_test_12345',
          stake_id: '99',
          sender_addr: 'GBWMOCKWALLETADDRESSFORTESTINGPURPOSES1234567890',
          recipient_id: 'usr_alice_123',
          recipient_handle: 'alice',
          status: 'delivered',
          created_at: new Date().toISOString(),
          stake_amount: '5',
          deadline: Math.floor(Date.now() / 1000) + 259200,
          time_left_secs: 259200,
        }),
      });
    });
  });

  test('Recipient Flow: onboarding, trustline guidance, telegram linking, and inbox actions', async ({
    page,
  }) => {
    // 1. Visit onboarding
    await page.goto('/onboarding');
    await expect(page.locator('h1')).toContainText('Recipient Onboarding');

    // 2. Connect mock wallet
    await page.click('button:has-text("Mock Wallet")');
    await expect(page.locator('text=Connected')).toBeVisible();

    // 3. USDC Trustline guidance with sponsored reserves
    await expect(page.locator('text=USDC Trustline Setup')).toBeVisible();
    await expect(page.locator('text=BEGIN_SPONSORING_FUTURE_RESERVES')).toBeVisible();
    await page.click('button:has-text("Add Sponsored USDC Trustline")');
    await expect(page.locator('text=USDC Trustline Active')).toBeVisible();

    // 4. Link Telegram channel
    await page.click('button:has-text("Connect Telegram")');
    await expect(page.locator('code')).toContainText('/start');

    // 5. Update pricing and windows
    await page.fill('#priceInput', '10');
    await page.fill('#windowInput', '5');
    await page.click('button:has-text("Save Pricing & Windows")');
    await expect(page.locator('text=Pricing and window successfully updated')).toBeVisible();

    // 6. View Recipient Inbox
    await page.goto('/inbox');
    await expect(page.locator('h1')).toContainText('Recipient Inbox');
    await expect(page.locator('article')).toHaveCount(3);
    await expect(page.locator('text=10 USDC Staked').first()).toBeVisible();

    // 7. Test Allowlist and Spam buttons in Inbox
    await page.click('article:first-child button:has-text("Allowlist Sender")');
    await expect(page.locator('article:first-child text=Allowlisted')).toBeVisible();

    // 8. View Earnings Dashboard
    await page.goto('/dashboard');
    await expect(page.locator('h1')).toContainText('Earnings Dashboard');
    await expect(page.locator('text=Total Claimed')).toBeVisible();
    await expect(page.locator('text=Spam Caught')).toBeVisible();
    await expect(page.locator('text=Reply Rate')).toBeVisible();
  });

  test('Sender Flow: compose page with plain language refund statement, sign & submit, and live tracker', async ({
    page,
  }) => {
    // 1. Visit compose page
    await page.goto('/compose');
    await expect(page.locator('h1')).toContainText('Compose Staked Message');

    // 2. Enter recipient handle and message
    await page.fill('#handleInput', 'alice');
    await page.fill('#bodyInput', 'Hello Alice! I would love to connect about the research grant.');

    // 3. Verify plain language refund rule statement
    const guaranteeCard = page.locator('div:has-text("Stake & Refund Guarantee")');
    await expect(guaranteeCard).toBeVisible();
    await expect(page.locator('text=You get 5 USDC back if alice replies by')).toBeVisible();
    await expect(page.locator('text=Otherwise she keeps it.')).toBeVisible();

    // 4. Sign & submit staked message
    await page.click('button:has-text("Sign & Stake 5 USDC")');

    // 5. Confirmation and transition to Stake Tracker
    await expect(page.locator('text=Message Delivered to Escrow!')).toBeVisible();
    await page.click('button:has-text("Track Stake Status")');

    // 6. Live tracker verification
    await expect(page.locator('h1')).toContainText('Stake Tracker');
    await expect(page.locator('text=msg_e2e_test_12345')).toBeVisible();
    await expect(page.locator('text=delivered')).toBeVisible();
    await expect(page.locator('text=5 USDC')).toBeVisible();
    await expect(page.locator('text=@alice')).toBeVisible();
  });
});
