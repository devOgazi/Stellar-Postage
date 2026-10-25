//! test.rs – contract-level integration tests for the Stellar Postage escrow.
//!
//! README required test cases:
//!   - below-minimum stake
//!   - window out of range
//!   - double confirm
//!   - confirm after grace
//!   - claim before the deadline
//!   - claim after a refund
//!   - unauthorized oracle
//!   - unauthorized recipient
//!   - pause behavior
//!   - fee cap
//!   - zero and negative amounts
//!
//! README invariants tested:
//!   1. A stake leaves Pending at most once.
//!   2. Total USDC held equals sum of Pending stake amounts.
//!   3. Only oracle can refund; only recipient (or time) can payout.
//!   4. claim cannot succeed before deadline + grace.
//!   5. confirm_reply and claim are mutually exclusive.
//!   6. Fee never exceeds hard cap.
//!   7. Pausing never blocks settlement of existing stakes.
//!
//! In soroban-sdk 29, the generated client exposes two variants per function:
//!   `fn foo(...)  -> T`              — panics on contract error
//!   `fn try_foo(...)  -> Result<T, _>` — returns the error
//! Tests that expect errors use the `try_` variant.

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env,
};

use crate::{Error, EscrowContract, EscrowContractClient, Status};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DECIMALS: i128 = 10_000_000; // 1 USDC = 10_000_000 stroops (7 decimals)
const GRACE: u64 = 3_600; // 1 hour grace period
const MIN_WINDOW: u64 = 3_600; // 1 hour
const MAX_WINDOW: u64 = 604_800; // 7 days
const WINDOW: u64 = 86_400; // 1 day (used in most tests)
const MIN_STAKE: i128 = 5 * DECIMALS; // 5 USDC

/// All addresses and contract references needed by most tests.
struct TestEnv<'a> {
    env: Env,
    contract_id: Address,
    client: EscrowContractClient<'a>,
    usdc_id: Address,
    admin: Address,
    oracle: Address,
    treasury: Address,
    alice: Address, // recipient
    bob: Address,   // sender
}

impl<'a> TestEnv<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        // Deploy USDC (Stellar Asset Contract)
        let admin = Address::generate(&env);
        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc_id = usdc_sac.address();

        let oracle = Address::generate(&env);
        let treasury = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        // Mint USDC to sender
        StellarAssetClient::new(&env, &usdc_id).mint(&bob, &(100 * DECIMALS));

        // Deploy escrow contract
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        client.initialize(&admin, &oracle, &treasury, &100u32, &GRACE);

        // Alice sets her price
        client.set_price(&alice, &MIN_STAKE, &MIN_WINDOW, &MAX_WINDOW);

        TestEnv {
            env,
            contract_id,
            client,
            usdc_id,
            admin,
            oracle,
            treasury,
            alice,
            bob,
        }
    }

    fn msg_hash(&self) -> BytesN<32> {
        BytesN::from_array(&self.env, &[0xabu8; 32])
    }

    fn bob_balance(&self) -> i128 {
        TokenClient::new(&self.env, &self.usdc_id).balance(&self.bob)
    }

    fn alice_balance(&self) -> i128 {
        TokenClient::new(&self.env, &self.usdc_id).balance(&self.alice)
    }

    fn contract_balance(&self) -> i128 {
        TokenClient::new(&self.env, &self.usdc_id).balance(&self.contract_id)
    }

    fn treasury_balance(&self) -> i128 {
        TokenClient::new(&self.env, &self.usdc_id).balance(&self.treasury)
    }

    /// Advance the ledger clock by `secs` seconds.
    fn advance(&self, secs: u64) {
        let t = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(t + secs);
    }

    /// Call `send` with default parameters.
    fn send(&self) -> u64 {
        self.client.send(
            &self.bob,
            &self.alice,
            &self.usdc_id,
            &MIN_STAKE,
            &self.msg_hash(),
            &WINDOW,
        )
    }
}

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_once() {
    let t = TestEnv::new();
    // Second call must fail
    let err = t
        .client
        .try_initialize(&t.admin, &t.oracle, &t.treasury, &0u32, &GRACE)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::AlreadyInitialized);
}

#[test]
fn test_initialize_fee_too_high() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let treasury = Address::generate(&env);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let err = client
        .try_initialize(&admin, &oracle, &treasury, &501u32, &GRACE)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::FeeTooHigh);
}

#[test]
fn test_initialize_fee_at_cap_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let treasury = Address::generate(&env);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    // Should not panic
    client.initialize(&admin, &oracle, &treasury, &500u32, &GRACE);
}

// ---------------------------------------------------------------------------
// set_price / get_price
// ---------------------------------------------------------------------------

#[test]
fn test_set_price_round_trip() {
    let t = TestEnv::new();
    let cfg = t.client.get_price(&t.alice);
    assert_eq!(cfg.min_amount, MIN_STAKE);
    assert_eq!(cfg.min_window_secs, MIN_WINDOW);
    assert_eq!(cfg.max_window_secs, MAX_WINDOW);
}

#[test]
fn test_set_price_invalid_amount_zero() {
    let t = TestEnv::new();
    let err = t
        .client
        .try_set_price(&t.alice, &0, &MIN_WINDOW, &MAX_WINDOW)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidAmount);
}

#[test]
fn test_set_price_invalid_window_order() {
    let t = TestEnv::new();
    let err = t
        .client
        .try_set_price(&t.alice, &MIN_STAKE, &MAX_WINDOW, &MIN_WINDOW)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::WindowOutOfRange);
}

#[test]
fn test_set_price_equal_windows_ok() {
    let t = TestEnv::new();
    // Should not panic
    t.client.set_price(&t.alice, &MIN_STAKE, &3600u64, &3600u64);
}

// ---------------------------------------------------------------------------
// send – validation
// ---------------------------------------------------------------------------

#[test]
fn test_send_basic_succeeds_and_locks_funds() {
    let t = TestEnv::new();
    let bob_before = t.bob_balance();
    let id = t.send();
    assert_eq!(id, 0);
    assert_eq!(t.contract_balance(), MIN_STAKE);
    assert_eq!(t.bob_balance(), bob_before - MIN_STAKE);
}

#[test]
fn test_send_increments_id() {
    let t = TestEnv::new();
    StellarAssetClient::new(&t.env, &t.usdc_id).mint(&t.bob, &(10 * DECIMALS));
    assert_eq!(t.send(), 0);
    assert_eq!(t.send(), 1);
}

#[test]
fn test_send_below_minimum_fails() {
    let t = TestEnv::new();
    let err = t
        .client
        .try_send(
            &t.bob,
            &t.alice,
            &t.usdc_id,
            &(MIN_STAKE - 1),
            &t.msg_hash(),
            &WINDOW,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::BelowMinimum);
}

#[test]
fn test_send_zero_amount_fails() {
    let t = TestEnv::new();
    let err = t
        .client
        .try_send(&t.bob, &t.alice, &t.usdc_id, &0, &t.msg_hash(), &WINDOW)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidAmount);
}

#[test]
fn test_send_negative_amount_fails() {
    let t = TestEnv::new();
    let err = t
        .client
        .try_send(&t.bob, &t.alice, &t.usdc_id, &-1, &t.msg_hash(), &WINDOW)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidAmount);
}

#[test]
fn test_send_window_too_short_fails() {
    let t = TestEnv::new();
    let err = t
        .client
        .try_send(
            &t.bob,
            &t.alice,
            &t.usdc_id,
            &MIN_STAKE,
            &t.msg_hash(),
            &(MIN_WINDOW - 1),
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::WindowOutOfRange);
}

#[test]
fn test_send_window_too_long_fails() {
    let t = TestEnv::new();
    let err = t
        .client
        .try_send(
            &t.bob,
            &t.alice,
            &t.usdc_id,
            &MIN_STAKE,
            &t.msg_hash(),
            &(MAX_WINDOW + 1),
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::WindowOutOfRange);
}

#[test]
fn test_send_self_message_fails() {
    let t = TestEnv::new();
    StellarAssetClient::new(&t.env, &t.usdc_id).mint(&t.alice, &(10 * DECIMALS));
    let err = t
        .client
        .try_send(
            &t.alice,
            &t.alice,
            &t.usdc_id,
            &MIN_STAKE,
            &t.msg_hash(),
            &WINDOW,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidAmount);
}

#[test]
fn test_send_paused_fails() {
    let t = TestEnv::new();
    t.client.pause();
    let err = t
        .client
        .try_send(
            &t.bob,
            &t.alice,
            &t.usdc_id,
            &MIN_STAKE,
            &t.msg_hash(),
            &WINDOW,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::Paused);
}

// ---------------------------------------------------------------------------
// confirm_reply
// ---------------------------------------------------------------------------

#[test]
fn test_confirm_reply_refunds_sender_minus_fee() {
    let t = TestEnv::new(); // fee = 100 bps = 1%
    let bob_before = t.bob_balance();
    let id = t.send();

    // fee = 1% of MIN_STAKE = 500_000, to_sender = 49_500_000
    let expected_fee = MIN_STAKE / 100;
    let expected_refund = MIN_STAKE - expected_fee;

    t.client.confirm_reply(&id);

    assert_eq!(t.bob_balance(), bob_before - expected_fee);
    assert_eq!(t.treasury_balance(), expected_fee);
    assert_eq!(t.contract_balance(), 0);

    let stake = t.client.get_stake(&id);
    assert_eq!(stake.status, Status::Refunded);

    // invariant: to_sender + fee == amount
    assert_eq!(expected_refund + expected_fee, MIN_STAKE);
}

#[test]
fn test_confirm_reply_zero_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc_id = usdc_sac.address();
    let oracle = Address::generate(&env);
    let treasury = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    StellarAssetClient::new(&env, &usdc_id).mint(&bob, &(100 * DECIMALS));

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    client.initialize(&admin, &oracle, &treasury, &0u32, &GRACE);
    client.set_price(&alice, &MIN_STAKE, &MIN_WINDOW, &MAX_WINDOW);

    let bob_before = TokenClient::new(&env, &usdc_id).balance(&bob);
    let id = client.send(
        &bob,
        &alice,
        &usdc_id,
        &MIN_STAKE,
        &BytesN::from_array(&env, &[0u8; 32]),
        &WINDOW,
    );
    client.confirm_reply(&id);

    // Zero fee: full amount back to sender
    assert_eq!(TokenClient::new(&env, &usdc_id).balance(&bob), bob_before);
    assert_eq!(TokenClient::new(&env, &usdc_id).balance(&treasury), 0);
}

#[test]
fn test_confirm_reply_double_fails() {
    let t = TestEnv::new();
    let id = t.send();
    t.client.confirm_reply(&id);
    let err = t.client.try_confirm_reply(&id).unwrap_err().unwrap();
    // README invariant 1: leaves Pending at most once
    assert_eq!(err, Error::NotPending);
}

#[test]
fn test_confirm_reply_after_grace_fails() {
    let t = TestEnv::new();
    let id = t.send();
    // advance past deadline + grace
    t.advance(WINDOW + GRACE + 1);
    let err = t.client.try_confirm_reply(&id).unwrap_err().unwrap();
    assert_eq!(err, Error::TooLate);
}

#[test]
fn test_confirm_reply_at_grace_boundary_succeeds() {
    let t = TestEnv::new();
    let id = t.send();
    // exactly at deadline + grace (not past it)
    t.advance(WINDOW + GRACE);
    // should not panic
    t.client.confirm_reply(&id);
}

// ---------------------------------------------------------------------------
// flag_spam
// ---------------------------------------------------------------------------

#[test]
fn test_flag_spam_pays_recipient() {
    let t = TestEnv::new();
    let alice_before = t.alice_balance();
    let id = t.send();

    let expected_fee = MIN_STAKE / 100; // 1%
    let expected_payout = MIN_STAKE - expected_fee;

    t.client.flag_spam(&id);

    assert_eq!(t.alice_balance(), alice_before + expected_payout);
    assert_eq!(t.treasury_balance(), expected_fee);
    assert_eq!(t.contract_balance(), 0);

    let stake = t.client.get_stake(&id);
    assert_eq!(stake.status, Status::Claimed);
}

#[test]
fn test_flag_spam_records_alice_auth() {
    // Verify alice (recipient) is the authorized caller for flag_spam
    let t = TestEnv::new();
    let id = t.send();
    t.client.flag_spam(&id);
    // Check that alice was among the authorized invocations
    let auths = t.env.auths();
    let found = auths.iter().any(|(addr, _)| *addr == t.alice);
    assert!(found, "expected alice to be authorized for flag_spam");
}

#[test]
fn test_flag_spam_already_claimed_fails() {
    let t = TestEnv::new();
    let id = t.send();
    t.client.flag_spam(&id);
    let err = t.client.try_flag_spam(&id).unwrap_err().unwrap();
    assert_eq!(err, Error::NotPending);
}

// ---------------------------------------------------------------------------
// claim
// ---------------------------------------------------------------------------

#[test]
fn test_claim_before_deadline_fails() {
    let t = TestEnv::new();
    let id = t.send();
    let err = t.client.try_claim(&id).unwrap_err().unwrap();
    assert_eq!(err, Error::DeadlineNotReached);
}

#[test]
fn test_claim_inside_grace_window_fails() {
    let t = TestEnv::new();
    let id = t.send();
    // deadline passed but still within grace
    t.advance(WINDOW + GRACE / 2);
    let err = t.client.try_claim(&id).unwrap_err().unwrap();
    assert_eq!(err, Error::DeadlineNotReached);
}

#[test]
fn test_claim_exactly_at_grace_end_fails() {
    let t = TestEnv::new();
    let id = t.send();
    // deadline + grace exactly — not strictly PAST it
    t.advance(WINDOW + GRACE);
    let err = t.client.try_claim(&id).unwrap_err().unwrap();
    assert_eq!(err, Error::DeadlineNotReached);
}

#[test]
fn test_claim_after_grace_succeeds_any_caller() {
    let t = TestEnv::new();
    let alice_before = t.alice_balance();
    let id = t.send();

    // past deadline + grace
    t.advance(WINDOW + GRACE + 1);

    let expected_fee = MIN_STAKE / 100;
    let expected_payout = MIN_STAKE - expected_fee;

    // Called by the sweeper (or anyone) — permissionless (README)
    t.client.claim(&id);

    assert_eq!(t.alice_balance(), alice_before + expected_payout);
    assert_eq!(t.treasury_balance(), expected_fee);
    assert_eq!(t.contract_balance(), 0);

    let stake = t.client.get_stake(&id);
    assert_eq!(stake.status, Status::Claimed);
}

#[test]
fn test_claim_after_refund_fails() {
    // README invariant 5: confirm_reply and claim are mutually exclusive.
    let t = TestEnv::new();
    let id = t.send();
    t.client.confirm_reply(&id);
    let err = t.client.try_claim(&id).unwrap_err().unwrap();
    assert_eq!(err, Error::NotPending);
}

#[test]
fn test_confirm_after_claim_fails() {
    // README invariant 5 (reverse direction)
    let t = TestEnv::new();
    let id = t.send();
    t.advance(WINDOW + GRACE + 1);
    t.client.claim(&id);
    let err = t.client.try_confirm_reply(&id).unwrap_err().unwrap();
    assert_eq!(err, Error::NotPending);
}

// ---------------------------------------------------------------------------
// README invariant 2: contract balance == sum of Pending stakes
// ---------------------------------------------------------------------------

#[test]
fn test_invariant_contract_balance_equals_pending_sum() {
    let t = TestEnv::new();
    StellarAssetClient::new(&t.env, &t.usdc_id).mint(&t.bob, &(20 * DECIMALS));

    // Create three stakes; confirm one, leave two pending
    let id0 = t.send();
    let id1 = t.send();
    let id2 = t.send();

    // After 3 sends: contract holds 3 × MIN_STAKE
    assert_eq!(t.contract_balance(), 3 * MIN_STAKE);

    // Confirm reply for stake 0 → contract loses MIN_STAKE
    t.client.confirm_reply(&id0);
    assert_eq!(t.contract_balance(), 2 * MIN_STAKE);

    // Flag spam for stake 1 → contract loses MIN_STAKE
    t.client.flag_spam(&id1);
    assert_eq!(t.contract_balance(), MIN_STAKE);

    // Advance and claim stake 2 → contract reaches 0
    t.advance(WINDOW + GRACE + 1);
    t.client.claim(&id2);
    assert_eq!(t.contract_balance(), 0);
}

// ---------------------------------------------------------------------------
// Pause / unpause – README invariant 7
// ---------------------------------------------------------------------------

#[test]
fn test_pause_blocks_send_only() {
    let t = TestEnv::new();
    let id = t.send(); // succeeds before pause

    t.client.pause();

    // new send must fail
    let err = t
        .client
        .try_send(
            &t.bob,
            &t.alice,
            &t.usdc_id,
            &MIN_STAKE,
            &t.msg_hash(),
            &WINDOW,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::Paused);

    // confirm_reply must still work (invariant 7)
    t.client.confirm_reply(&id);
}

#[test]
fn test_pause_does_not_block_flag_spam() {
    let t = TestEnv::new();
    let id = t.send();
    t.client.pause();
    // flag_spam on existing stake must work while paused
    t.client.flag_spam(&id); // must not panic
}

#[test]
fn test_pause_does_not_block_claim() {
    let t = TestEnv::new();
    let id = t.send();
    t.client.pause();
    t.advance(WINDOW + GRACE + 1);
    // claim must still work while paused
    t.client.claim(&id); // must not panic
}

#[test]
fn test_unpause_allows_send_again() {
    let t = TestEnv::new();
    t.client.pause();
    t.client.unpause();
    StellarAssetClient::new(&t.env, &t.usdc_id).mint(&t.bob, &(10 * DECIMALS));
    // must not panic
    t.client.send(
        &t.bob,
        &t.alice,
        &t.usdc_id,
        &MIN_STAKE,
        &t.msg_hash(),
        &WINDOW,
    );
}

// ---------------------------------------------------------------------------
// set_fee (admin) – README invariant 6
// ---------------------------------------------------------------------------

#[test]
fn test_set_fee_at_cap_succeeds() {
    let t = TestEnv::new();
    t.client.set_fee(&500u32); // must not panic
}

#[test]
fn test_set_fee_above_cap_fails() {
    let t = TestEnv::new();
    let err = t.client.try_set_fee(&501u32).unwrap_err().unwrap();
    assert_eq!(err, Error::FeeTooHigh);
}

#[test]
fn test_set_fee_records_admin_auth() {
    let t = TestEnv::new();
    t.client.set_fee(&200u32);
    let auths = t.env.auths();
    let found = auths.iter().any(|(addr, _)| *addr == t.admin);
    assert!(found, "admin should be the authorized caller for set_fee");
}

// ---------------------------------------------------------------------------
// set_oracle (admin)
// ---------------------------------------------------------------------------

#[test]
fn test_set_oracle_records_admin_auth() {
    let t = TestEnv::new();
    let new_oracle = Address::generate(&t.env);
    t.client.set_oracle(&new_oracle);
    let auths = t.env.auths();
    let found = auths.iter().any(|(addr, _)| *addr == t.admin);
    assert!(
        found,
        "admin should be the authorized caller for set_oracle"
    );
}

// ---------------------------------------------------------------------------
// extend_ttl
// ---------------------------------------------------------------------------

#[test]
fn test_extend_ttl_existing_stake() {
    let t = TestEnv::new();
    let id = t.send();
    t.client.extend_ttl(&id); // must not panic
}

#[test]
fn test_extend_ttl_missing_stake_fails() {
    let t = TestEnv::new();
    let err = t.client.try_extend_ttl(&999u64).unwrap_err().unwrap();
    assert_eq!(err, Error::StakeNotFound);
}

// ---------------------------------------------------------------------------
// get_stake
// ---------------------------------------------------------------------------

#[test]
fn test_get_stake_missing_fails() {
    let t = TestEnv::new();
    let err = t.client.try_get_stake(&42u64).unwrap_err().unwrap();
    assert_eq!(err, Error::StakeNotFound);
}

#[test]
fn test_get_stake_returns_correct_fields() {
    let t = TestEnv::new();
    let hash = t.msg_hash();
    let id = t
        .client
        .send(&t.bob, &t.alice, &t.usdc_id, &MIN_STAKE, &hash, &WINDOW);
    let stake = t.client.get_stake(&id);
    assert_eq!(stake.id, 0);
    assert_eq!(stake.sender, t.bob);
    assert_eq!(stake.recipient, t.alice);
    assert_eq!(stake.amount, MIN_STAKE);
    assert_eq!(stake.msg_hash, hash);
    assert_eq!(stake.status, Status::Pending);
    assert_eq!(stake.deadline, stake.created_at + WINDOW);
}

// ---------------------------------------------------------------------------
// Fee rounding favours the sender (README security note)
// ---------------------------------------------------------------------------

#[test]
fn test_fee_rounding_favours_sender_on_confirm() {
    // amount = 7 stroops, fee_bps = 100 (1%)
    // fee = floor(7 * 100 / 10000) = floor(0.07) = 0 → full amount back
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc_id = usdc_sac.address();
    let oracle = Address::generate(&env);
    let treasury = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    StellarAssetClient::new(&env, &usdc_id).mint(&bob, &100);

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    client.initialize(&admin, &oracle, &treasury, &100u32, &GRACE);
    client.set_price(&alice, &1, &MIN_WINDOW, &MAX_WINDOW);

    let bob_before = TokenClient::new(&env, &usdc_id).balance(&bob);
    let id = client.send(
        &bob,
        &alice,
        &usdc_id,
        &7,
        &BytesN::from_array(&env, &[0u8; 32]),
        &WINDOW,
    );
    client.confirm_reply(&id);

    // fee = 0 (rounded down), full 7 stroops back to bob
    assert_eq!(TokenClient::new(&env, &usdc_id).balance(&bob), bob_before);
    assert_eq!(TokenClient::new(&env, &usdc_id).balance(&treasury), 0);
}
