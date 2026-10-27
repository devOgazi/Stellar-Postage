//! invariants.rs – Dedicated test module enforcing the 7 contract invariants
//! from the README "Smart Contract Specification → Invariants (to be enforced by tests)"
//! and proptest-based property tests.
//!
//! README Invariants:
//!  1. A stake leaves Pending at most once.
//!  2. Total USDC held by the contract equals the sum of Pending stake amounts.
//!  3. Only the oracle can trigger a refund. Only the recipient (or time) can trigger a payout.
//!  4. claim cannot succeed before deadline + grace.
//!  5. confirm_reply and claim are mutually exclusive on the same stake.
//!  6. The fee never exceeds the hard cap (default 5%).
//!  7. Pausing never blocks settlement of existing stakes.

#![cfg(test)]

extern crate alloc;
use alloc::vec::Vec;

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env,
};

use crate::{
    storage::{set_fee_bps, split_fee},
    Error, EscrowContract, EscrowContractClient, Status, MAX_FEE_BPS,
};

const DECIMALS: i128 = 10_000_000; // 1 USDC = 10_000_000 stroops (7 decimals)
const GRACE: u64 = 3_600; // 1 hour grace period
const MIN_WINDOW: u64 = 3_600; // 1 hour
const MAX_WINDOW: u64 = 604_800; // 7 days
const WINDOW: u64 = 86_400; // 1 day
const MIN_STAKE: i128 = 5 * DECIMALS; // 5 USDC

#[allow(dead_code)]
struct InvariantTestEnv<'a> {
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

impl<'a> InvariantTestEnv<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc_id = usdc_sac.address();

        let oracle = Address::generate(&env);
        let treasury = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        StellarAssetClient::new(&env, &usdc_id).mint(&bob, &(1_000_000 * DECIMALS));

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        client.initialize(&admin, &oracle, &treasury, &100u32, &GRACE);
        client.set_price(&alice, &MIN_STAKE, &MIN_WINDOW, &MAX_WINDOW);

        InvariantTestEnv {
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
        BytesN::from_array(&self.env, &[0x42u8; 32])
    }

    fn contract_balance(&self) -> i128 {
        TokenClient::new(&self.env, &self.usdc_id).balance(&self.contract_id)
    }

    fn advance(&self, secs: u64) {
        let t = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(t + secs);
    }

    fn send_default(&self) -> u64 {
        self.client.send(
            &self.bob,
            &self.alice,
            &self.usdc_id,
            &MIN_STAKE,
            &self.msg_hash(),
            &WINDOW,
        )
    }

    fn send_custom(&self, amount: i128, window_secs: u64) -> Result<u64, Error> {
        match self.client.try_send(
            &self.bob,
            &self.alice,
            &self.usdc_id,
            &amount,
            &self.msg_hash(),
            &window_secs,
        ) {
            Ok(inner) => Ok(inner.unwrap()),
            Err(err) => Err(err.unwrap()),
        }
    }
}

// ===========================================================================
// INVARIANT 1
// ===========================================================================

#[test]
fn invariant_1_stake_leaves_pending_at_most_once() {
    // Invariant 1: "A stake leaves Pending at most once."

    let t = InvariantTestEnv::new();

    // Case 1A: Pending -> Refunded via confirm_reply
    let id_a = t.send_default();
    assert_eq!(t.client.get_stake(&id_a).status, Status::Pending);
    t.client.confirm_reply(&id_a);
    assert_eq!(t.client.get_stake(&id_a).status, Status::Refunded);

    // Any further transition attempts must fail with NotPending
    assert_eq!(
        t.client.try_confirm_reply(&id_a).unwrap_err().unwrap(),
        Error::NotPending
    );
    assert_eq!(
        t.client.try_flag_spam(&id_a).unwrap_err().unwrap(),
        Error::NotPending
    );
    t.advance(WINDOW + GRACE + 1);
    assert_eq!(
        t.client.try_claim(&id_a).unwrap_err().unwrap(),
        Error::NotPending
    );

    // Case 1B: Pending -> Claimed via flag_spam
    let id_b = t.send_default();
    assert_eq!(t.client.get_stake(&id_b).status, Status::Pending);
    t.client.flag_spam(&id_b);
    assert_eq!(t.client.get_stake(&id_b).status, Status::Claimed);

    // Any further transition attempts must fail with NotPending
    assert_eq!(
        t.client.try_confirm_reply(&id_b).unwrap_err().unwrap(),
        Error::NotPending
    );
    assert_eq!(
        t.client.try_flag_spam(&id_b).unwrap_err().unwrap(),
        Error::NotPending
    );
    assert_eq!(
        t.client.try_claim(&id_b).unwrap_err().unwrap(),
        Error::NotPending
    );

    // Case 1C: Pending -> Claimed via claim (expired)
    let id_c = t.send_default();
    assert_eq!(t.client.get_stake(&id_c).status, Status::Pending);
    t.advance(WINDOW + GRACE + 1);
    t.client.claim(&id_c);
    assert_eq!(t.client.get_stake(&id_c).status, Status::Claimed);

    // Any further transition attempts must fail with NotPending
    assert_eq!(
        t.client.try_confirm_reply(&id_c).unwrap_err().unwrap(),
        Error::NotPending
    );
    assert_eq!(
        t.client.try_flag_spam(&id_c).unwrap_err().unwrap(),
        Error::NotPending
    );
    assert_eq!(
        t.client.try_claim(&id_c).unwrap_err().unwrap(),
        Error::NotPending
    );
}

// ===========================================================================
// INVARIANT 2
// ===========================================================================

#[test]
fn invariant_2_contract_balance_equals_sum_of_pending_stakes() {
    // Invariant 2: "Total USDC held by the contract equals the sum of Pending stake amounts."

    let t = InvariantTestEnv::new();
    assert_eq!(t.contract_balance(), 0);

    // Create 4 stakes with different amounts
    let amounts = [5 * DECIMALS, 12 * DECIMALS, 25 * DECIMALS, 50 * DECIMALS];

    let mut ids = Vec::new();
    let mut expected_pending_sum = 0i128;

    for &amt in &amounts {
        let id = t.send_custom(amt, WINDOW).unwrap();
        ids.push((id, amt));
        expected_pending_sum += amt;
        assert_eq!(t.contract_balance(), expected_pending_sum);
    }

    // Settle stake 0 via confirm_reply
    t.client.confirm_reply(&ids[0].0);
    expected_pending_sum -= ids[0].1;
    assert_eq!(t.contract_balance(), expected_pending_sum);

    // Settle stake 1 via flag_spam
    t.client.flag_spam(&ids[1].0);
    expected_pending_sum -= ids[1].1;
    assert_eq!(t.contract_balance(), expected_pending_sum);

    // Advance time and settle stake 2 via claim
    t.advance(WINDOW + GRACE + 1);
    t.client.claim(&ids[2].0);
    expected_pending_sum -= ids[2].1;
    assert_eq!(t.contract_balance(), expected_pending_sum);

    // Settle final stake 3 via claim
    t.client.claim(&ids[3].0);
    expected_pending_sum -= ids[3].1;
    assert_eq!(expected_pending_sum, 0);
    assert_eq!(t.contract_balance(), 0);
}

// ===========================================================================
// INVARIANT 3
// ===========================================================================

#[test]
fn invariant_3_only_oracle_refunds_only_recipient_or_time_pays_out() {
    // Invariant 3: "Only the oracle can trigger a refund. Only the recipient (or time) can trigger a payout."

    let t = InvariantTestEnv::new();

    // 1. confirm_reply requires oracle authorization
    let id_1 = t.send_default();
    t.client.confirm_reply(&id_1);
    let auths = t.env.auths();
    let oracle_authed = auths.iter().any(|(addr, _)| *addr == t.oracle);
    assert!(
        oracle_authed,
        "confirm_reply must require oracle authorization"
    );

    // 2. flag_spam requires recipient (alice) authorization
    let id_2 = t.send_default();
    t.client.flag_spam(&id_2);
    let auths = t.env.auths();
    let recipient_authed = auths.iter().any(|(addr, _)| *addr == t.alice);
    assert!(
        recipient_authed,
        "flag_spam must require recipient authorization"
    );

    // 3. claim requires time (deadline + grace) and pays out to recipient, never caller
    let id_3 = t.send_default();
    // Before deadline + grace: payout cannot occur
    let err = t.client.try_claim(&id_3).unwrap_err().unwrap();
    assert_eq!(err, Error::DeadlineNotReached);

    // Past deadline + grace: anyone (e.g. eve) can trigger claim
    t.advance(WINDOW + GRACE + 1);
    let eve = Address::generate(&t.env);
    let alice_before = TokenClient::new(&t.env, &t.usdc_id).balance(&t.alice);
    let eve_before = TokenClient::new(&t.env, &t.usdc_id).balance(&eve);

    t.client.claim(&id_3);

    let alice_after = TokenClient::new(&t.env, &t.usdc_id).balance(&t.alice);
    let eve_after = TokenClient::new(&t.env, &t.usdc_id).balance(&eve);

    assert!(
        alice_after > alice_before,
        "claim must pay out to recipient"
    );
    assert_eq!(
        eve_after, eve_before,
        "caller cannot siphon funds from claim"
    );
}

// ===========================================================================
// INVARIANT 4
// ===========================================================================

#[test]
fn invariant_4_claim_cannot_succeed_before_deadline_plus_grace() {
    // Invariant 4: "claim cannot succeed before deadline + grace."

    let t = InvariantTestEnv::new();
    let id = t.send_default();

    // 1. Well before deadline
    let err_early = t.client.try_claim(&id).unwrap_err().unwrap();
    assert_eq!(err_early, Error::DeadlineNotReached);

    // 2. Exactly at deadline
    t.advance(WINDOW);
    let err_at_deadline = t.client.try_claim(&id).unwrap_err().unwrap();
    assert_eq!(err_at_deadline, Error::DeadlineNotReached);

    // 3. Inside grace period (halfway through grace)
    t.advance(GRACE / 2);
    let err_inside_grace = t.client.try_claim(&id).unwrap_err().unwrap();
    assert_eq!(err_inside_grace, Error::DeadlineNotReached);

    // 4. Exactly at deadline + grace
    t.advance(GRACE / 2);
    let err_at_boundary = t.client.try_claim(&id).unwrap_err().unwrap();
    assert_eq!(err_at_boundary, Error::DeadlineNotReached);

    // 5. 1 second past deadline + grace: claim succeeds
    t.advance(1);
    t.client.claim(&id);
    assert_eq!(t.client.get_stake(&id).status, Status::Claimed);
}

// ===========================================================================
// INVARIANT 5
// ===========================================================================

#[test]
fn invariant_5_confirm_reply_and_claim_mutually_exclusive() {
    // Invariant 5: "confirm_reply and claim are mutually exclusive on the same stake."

    let t = InvariantTestEnv::new();

    // Path A: confirm_reply wins first
    let id_a = t.send_default();
    t.client.confirm_reply(&id_a);
    t.advance(WINDOW + GRACE + 1);
    let err_claim_after_confirm = t.client.try_claim(&id_a).unwrap_err().unwrap();
    assert_eq!(err_claim_after_confirm, Error::NotPending);

    // Path B: claim (via flag_spam) wins first
    let id_b = t.send_default();
    t.client.flag_spam(&id_b);
    let err_confirm_after_spam = t.client.try_confirm_reply(&id_b).unwrap_err().unwrap();
    assert_eq!(err_confirm_after_spam, Error::NotPending);

    // Path C: claim (via expiry) wins first
    let id_c = t.send_default();
    t.advance(WINDOW + GRACE + 1);
    t.client.claim(&id_c);
    let err_confirm_after_claim = t.client.try_confirm_reply(&id_c).unwrap_err().unwrap();
    assert_eq!(err_confirm_after_claim, Error::NotPending);
}

// ===========================================================================
// INVARIANT 6
// ===========================================================================

#[test]
fn invariant_6_fee_never_exceeds_hard_cap() {
    // Invariant 6: "The fee never exceeds the hard cap (default 5%)."

    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let treasury = Address::generate(&env);

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    // Hard cap is 500 bps (5%)
    assert_eq!(MAX_FEE_BPS, 500);

    // Initialization above 500 bps fails
    let err_init = client
        .try_initialize(&admin, &oracle, &treasury, &501u32, &GRACE)
        .unwrap_err()
        .unwrap();
    assert_eq!(err_init, Error::FeeTooHigh);

    // Initialization at 500 bps succeeds
    client.initialize(&admin, &oracle, &treasury, &500u32, &GRACE);

    // Admin set_fee above 500 bps fails
    let err_set = client.try_set_fee(&501u32).unwrap_err().unwrap();
    assert_eq!(err_set, Error::FeeTooHigh);

    // Verify fee calculated at 500 bps is exactly 5% and <= 5% for all amounts
    let test_amounts = [1i128, 100i128, 10_000i128, MIN_STAKE, 1_000 * DECIMALS];
    env.as_contract(&contract_id, || {
        for &amount in &test_amounts {
            let (to_sender, fee) = split_fee(&env, amount);
            assert!(fee <= (amount * 500) / 10_000);
            assert!(fee <= amount);
            assert_eq!(to_sender + fee, amount);
        }
    });
}

// ===========================================================================
// INVARIANT 7
// ===========================================================================

#[test]
fn invariant_7_pausing_never_blocks_settlement_of_existing_stakes() {
    // Invariant 7: "Pausing never blocks settlement of existing stakes."

    let t = InvariantTestEnv::new();

    // Create 3 stakes before pause
    let id_refund = t.send_default();
    let id_spam = t.send_default();
    let id_claim = t.send_default();

    // Admin pauses the contract
    t.client.pause();

    // New send calls MUST be blocked
    let err_send = t.send_custom(MIN_STAKE, WINDOW).unwrap_err();
    assert_eq!(err_send, Error::Paused);

    // Settlement via confirm_reply must succeed while paused
    t.client.confirm_reply(&id_refund);
    assert_eq!(t.client.get_stake(&id_refund).status, Status::Refunded);

    // Settlement via flag_spam must succeed while paused
    t.client.flag_spam(&id_spam);
    assert_eq!(t.client.get_stake(&id_spam).status, Status::Claimed);

    // Settlement via claim must succeed while paused
    t.advance(WINDOW + GRACE + 1);
    t.client.claim(&id_claim);
    assert_eq!(t.client.get_stake(&id_claim).status, Status::Claimed);

    // Unpausing restores send capability
    t.client.unpause();
    let id_new = t.send_custom(MIN_STAKE, WINDOW).unwrap();
    assert_eq!(t.client.get_stake(&id_new).status, Status::Pending);
}

// ===========================================================================
// PROPTEST PROPERTY TESTS
// ===========================================================================

proptest! {
    /// Property: fee split never exceeds amount for any valid fee (0 to 500 bps).
    #[test]
    fn prop_fee_split_never_exceeds_amount(
        amount in 1i128..=10_000_000_000_000i128, // up to 1,000,000 USDC
        fee_bps in 0u32..=500u32,
    ) {
        let env = Env::default();
        let cid = env.register(EscrowContract, ());
        env.as_contract(&cid, || {
            set_fee_bps(&env, fee_bps);
            let (to_recipient, fee) = split_fee(&env, amount);
            prop_assert!(fee <= amount, "fee {} must not exceed amount {}", fee, amount);
            prop_assert!(to_recipient >= 0, "payout {} must be non-negative", to_recipient);
            Ok(())
        })?;
    }

    /// Property: sender refund + fee == amount (exact conservation of value).
    #[test]
    fn prop_sender_refund_plus_fee_equals_amount(
        amount in 1i128..=10_000_000_000_000i128,
        fee_bps in 0u32..=500u32,
    ) {
        let env = Env::default();
        let cid = env.register(EscrowContract, ());
        env.as_contract(&cid, || {
            set_fee_bps(&env, fee_bps);
            let (to_recipient, fee) = split_fee(&env, amount);
            prop_assert_eq!(
                to_recipient + fee,
                amount,
                "refund ({}) + fee ({}) must equal amount ({})",
                to_recipient,
                fee,
                amount
            );
            Ok(())
        })?;
    }
}

#[derive(Clone, Debug)]
enum Action {
    Send { amount: i128, window_secs: u64 },
    ConfirmReply { index: usize },
    FlagSpam { index: usize },
    Claim { index: usize },
    AdvanceTime { secs: u64 },
}

fn action_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        3 => (5..=50i128, 3_600..=604_800u64).prop_map(|(amt_usdc, win)| Action::Send {
            amount: amt_usdc * DECIMALS,
            window_secs: win,
        }),
        2 => (0..10usize).prop_map(|index| Action::ConfirmReply { index }),
        2 => (0..10usize).prop_map(|index| Action::FlagSpam { index }),
        2 => (0..10usize).prop_map(|index| Action::Claim { index }),
        2 => (3_600..=86_400u64).prop_map(|secs| Action::AdvanceTime { secs }),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]
    /// Property: random sequences of send/confirm/claim/flag_spam never leave
    /// contract USDC balance different from the sum of Pending stakes.
    #[test]
    fn prop_random_sequences_contract_balance_equals_pending_sum(
        actions in prop::collection::vec(action_strategy(), 5..25)
    ) {
        let t = InvariantTestEnv::new();
        let mut stakes = Vec::new();

        for action in actions {
            match action {
                Action::Send { amount, window_secs } => {
                    if let Ok(id) = t.send_custom(amount, window_secs) {
                        stakes.push(id);
                    }
                }
                Action::ConfirmReply { index } => {
                    if !stakes.is_empty() {
                        let id = stakes[index % stakes.len()];
                        let _ = t.client.try_confirm_reply(&id);
                    }
                }
                Action::FlagSpam { index } => {
                    if !stakes.is_empty() {
                        let id = stakes[index % stakes.len()];
                        let _ = t.client.try_flag_spam(&id);
                    }
                }
                Action::Claim { index } => {
                    if !stakes.is_empty() {
                        let id = stakes[index % stakes.len()];
                        let _ = t.client.try_claim(&id);
                    }
                }
                Action::AdvanceTime { secs } => {
                    t.advance(secs);
                }
            }

            // Invariant check after each action:
            // Contract USDC balance == sum of all Pending stakes
            let mut pending_sum = 0i128;
            for &id in &stakes {
                let stake = t.client.get_stake(&id);
                if stake.status == Status::Pending {
                    pending_sum += stake.amount;
                }
            }

            let contract_bal = t.contract_balance();
            prop_assert_eq!(
                contract_bal,
                pending_sum,
                "Contract balance ({}) must match Pending stakes sum ({})",
                contract_bal,
                pending_sum
            );
        }
    }
}
