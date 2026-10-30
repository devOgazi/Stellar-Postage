/**
 * tests/e2e/src/e2e.test.ts
 * End-to-End integration suite running two complete lifecycle scenarios:
 * (1) set_price -> send -> deliver -> reply -> veto window elapses -> oracle confirms -> sender refunded -> indexer shows Refunded
 * (2) send -> ignored -> deadline + grace passes -> sweeper claims -> recipient paid -> indexer shows Claimed
 */

import crypto from 'node:crypto';
import { E2ETestEnvironment } from './environment.js';

describe('Stellar Postage E2E Integration Suite', () => {
  let env: E2ETestEnvironment;

  beforeAll(async () => {
    // Attempt Docker container startup if Docker is running
    E2ETestEnvironment.tryStartContainers();
    env = new E2ETestEnvironment();
    await env.setup();
  });

  afterAll(async () => {
    await env.teardown();
    E2ETestEnvironment.tryStopContainers();
  });

  test('Scenario 1: Happy path - set_price, send, deliver, reply, veto window elapses, oracle confirms, sender refunded, indexer shows Refunded', async () => {
    const aliceAddr = env.participants.alice.publicKey();
    const bobAddr = env.participants.bob.publicKey();
    const adminAddr = env.participants.admin.publicKey();
    const contractAddr = env.contractId;

    // 0. Initial Balances Check
    // Bob: 100 USDC (1,000,000,000 stroops), Alice: 0, Escrow: 0
    expect(await env.getBalance(bobAddr)).toBe(1_000_000_000n);
    expect(await env.getBalance(aliceAddr)).toBe(0n);
    expect(await env.getBalance(contractAddr)).toBe(0n);

    // 1. set_price: Alice sets pricing on-chain
    const minAmount = 50_000_000n; // 5 USDC
    const minWindow = 3600n;
    const maxWindow = 86400n;
    await env.escrowClient.setPrice({
      recipient: aliceAddr,
      minAmount,
      minWindow,
      maxWindow,
    });
    const priceConfig = await env.escrowClient.fetchPrice(aliceAddr);
    expect(priceConfig.min_amount).toBe(minAmount);

    // 2. send: Bob stakes 5 USDC to message Alice
    const messageBody =
      'Hi Alice, exciting business inquiry regarding Stellar Postage integration!';
    const msgHash = crypto.createHash('sha256').update(messageBody).digest();

    const sendRes = await env.escrowClient.send({
      sender: bobAddr,
      recipient: aliceAddr,
      token: env.usdcSacId,
      amount: minAmount,
      msgHash,
      windowSecs: 3600n,
    });
    const stakeId = (sendRes as any)['stakeId'] as bigint;
    expect(stakeId).toBeDefined();

    // Assert On-chain Balances after send
    expect(await env.getBalance(bobAddr)).toBe(950_000_000n); // 1,000 - 50 USDC
    expect(await env.getBalance(contractAddr)).toBe(50_000_000n); // Contract holds 50 USDC
    expect(await env.getBalance(aliceAddr)).toBe(0n);

    // Assert On-chain Stake state
    const stakeAfterSend = await env.escrowClient.fetchStake(stakeId);
    expect(stakeAfterSend.status).toBe('Pending');
    expect(stakeAfterSend.amount).toBe(minAmount);
    expect(stakeAfterSend.sender).toBe(bobAddr);
    expect(stakeAfterSend.recipient).toBe(aliceAddr);

    // Record Message in Database (as API service would)
    const aliceUser = await env.dal.findUserByAddress(aliceAddr);
    expect(aliceUser).not.toBeNull();
    const aliceChannel = (await env.dal.findChannelByKindAndExternalId('telegram', '123456789'))!;
    expect(aliceChannel).not.toBeNull();

    const dbMsg = await env.dal.createMessage({
      sender_addr: bobAddr,
      recipient_id: aliceUser!.id,
      channel_id: aliceChannel.id,
      body_enc: Buffer.from(messageBody, 'utf-8'),
      msg_hash: msgHash,
      status: 'pending',
    });
    await env.dal.attachStakeId(dbMsg.id, stakeId);

    // 3. deliver: Relay message to Alice's Telegram channel
    const tgMessageId = 42;
    await env.dal.updateMessageExternalRef(dbMsg.id, tgMessageId.toString());
    await env.dal.updateMessageStatus(dbMsg.id, 'delivered');

    const msgDelivered = await env.dal.findMessageById(dbMsg.id);
    expect(msgDelivered?.status).toBe('delivered');
    expect(msgDelivered?.external_ref).toBe('42');

    // 4. reply: Recipient Alice replies to the Telegram message
    const replyText =
      'Hello Bob! Thanks for reaching out. Yes, we would be delighted to partner on this integration.';
    const replyResult = await env.replyDetector.processUpdate({
      message: {
        message_id: 101,
        from: {
          id: 123456789,
          is_bot: false,
          first_name: 'Alice',
        },
        chat: {
          id: 123456789,
          type: 'private',
        },
        text: replyText,
        reply_to_message: {
          message_id: tgMessageId,
          text: messageBody,
        },
        date: Math.floor(Date.now() / 1000),
      },
    });

    expect(replyResult.accepted).toBe(true);
    expect(replyResult.evidence).toBeDefined();

    // Verify ReplyEvidence row in database
    const evidenceRow = await env.dal.findReplyEvidenceById(replyResult.evidence!.id);
    expect(evidenceRow).not.toBeNull();
    expect(evidenceRow?.message_id).toBe(dbMsg.id);
    expect(evidenceRow?.kind).toBe('telegram');
    expect(evidenceRow?.oracle_tx).toBeNull(); // Not submitted yet

    // 5. veto window elapses: Wait for veto timeout (configured as 1s in test)
    // After timeout, ReplyDetector calls onForwardToOracle -> OracleService.confirmReply
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // 6. oracle confirms: Check oracle transaction was recorded
    const updatedEvidence = await env.dal.findReplyEvidenceById(replyResult.evidence!.id);
    expect(updatedEvidence?.oracle_tx).toBeTruthy();

    // 7. sender refunded: Verify on-chain stake state & balances
    const stakeAfterReply = await env.escrowClient.fetchStake(stakeId);
    expect(stakeAfterReply.status).toBe('Refunded');

    // Protocol fee is 100 bps (1%) = 500,000 stroops
    // Sender gets 49,500,000 stroops back: 950,000,000 + 49,500,000 = 999,500,000
    // Admin gets fee: 500,000 stroops
    // Contract balance: 0
    expect(await env.getBalance(bobAddr)).toBe(999_500_000n);
    expect(await env.getBalance(contractAddr)).toBe(0n);
    expect(await env.getBalance(adminAddr)).toBe(500_000n);
    expect(await env.getBalance(aliceAddr)).toBe(0n);

    // 8. indexer shows Refunded: Indexer polls on-chain events
    const processedEvents = await env.indexerPoller.pollOnce();
    expect(processedEvents).toBeGreaterThanOrEqual(1);

    // Verify chain_events record
    const chainEvents = await env.dal.findChainEventsByStakeId(stakeId);
    const repliedEvent = chainEvents.find((e) => e.topic === 'replied');
    expect(repliedEvent).toBeDefined();

    // Verify message status updated to 'replied' in DB
    const finalMsg = await env.dal.findMessageById(dbMsg.id);
    expect(finalMsg?.status).toBe('replied');
  });

  test('Scenario 2: Unanswered/Ignored - send, ignored, deadline + grace passes, sweeper claims, recipient paid, indexer shows Claimed', async () => {
    const aliceAddr = env.participants.alice.publicKey();
    const bobAddr = env.participants.bob.publicKey();
    const contractAddr = env.contractId;

    // Initial balances at start of scenario 2:
    // Bob: 999,500,000 stroops (from scenario 1)
    // Alice: 0 stroops
    // Escrow: 0 stroops
    const initialBobBal = await env.getBalance(bobAddr);
    const initialAliceBal = await env.getBalance(aliceAddr);
    expect(await env.getBalance(contractAddr)).toBe(0n);

    // 1. send: Bob sends stake with a short 5-second response window
    const stakeAmount = 50_000_000n; // 5 USDC
    const windowSecs = 5n;
    const msgHash = crypto.createHash('sha256').update('Second message - will be ignored').digest();

    const sendRes = await env.escrowClient.send({
      sender: bobAddr,
      recipient: aliceAddr,
      token: env.usdcSacId,
      amount: stakeAmount,
      msgHash,
      windowSecs,
    });
    const stakeId = (sendRes as any)['stakeId'] as bigint;

    // Assert On-chain Balances after send
    expect(await env.getBalance(bobAddr)).toBe(initialBobBal - stakeAmount);
    expect(await env.getBalance(contractAddr)).toBe(stakeAmount);
    expect(await env.getBalance(aliceAddr)).toBe(initialAliceBal);

    // Create DB record for this message
    const aliceUser = (await env.dal.findUserByAddress(aliceAddr))!;
    const dbMsg = await env.dal.createMessage({
      sender_addr: bobAddr,
      recipient_id: aliceUser.id,
      body_enc: Buffer.from('Second message - will be ignored', 'utf-8'),
      msg_hash: msgHash,
      status: 'delivered',
    });
    await env.dal.attachStakeId(dbMsg.id, stakeId);

    // 2. ignored: Alice does not reply. No reply evidence or confirmation occurs.
    const stakePending = await env.escrowClient.fetchStake(stakeId);
    expect(stakePending.status).toBe('Pending');

    // 3. deadline + grace passes: Advance ledger time past window (5s) + grace (1s) = 6s
    env.advanceTime(15);

    // 4. sweeper claims: Sweeper sweeps expired pending stakes
    const sweepResult = await env.sweeperService.sweep({
      now: env.currentTimestamp * 1000,
    });
    expect(sweepResult.claimed.length).toBe(1);
    expect(sweepResult.claimed[0]?.stakeId).toBe(stakeId);

    // 5. recipient paid: Verify on-chain stake state & balances
    const stakeClaimed = await env.escrowClient.fetchStake(stakeId);
    expect(stakeClaimed.status).toBe('Claimed');

    // In claim after deadline, recipient Alice receives 100% of stake
    // Bob receives nothing
    // Contract balance returns to 0
    expect(await env.getBalance(aliceAddr)).toBe(initialAliceBal + stakeAmount);
    expect(await env.getBalance(contractAddr)).toBe(0n);
    expect(await env.getBalance(bobAddr)).toBe(initialBobBal - stakeAmount);

    // 6. indexer shows Claimed: Indexer polls events
    const processedEvents = await env.indexerPoller.pollOnce();
    expect(processedEvents).toBeGreaterThanOrEqual(1);

    // Verify chain_events record has 'claimed'
    const chainEvents = await env.dal.findChainEventsByStakeId(stakeId);
    const claimedEvent = chainEvents.find((e) => e.topic === 'claimed');
    expect(claimedEvent).toBeDefined();

    // Verify message status updated to 'expired' in DB per README
    const finalMsg = await env.dal.findMessageById(dbMsg.id);
    expect(finalMsg?.status).toBe('expired');
  });
});
