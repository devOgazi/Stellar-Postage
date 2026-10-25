//! storage.rs – storage helpers for the escrow contract.
//!
//! Design rules (from README):
//! - Config (Admin, Oracle, Treasury, FeeBps, GraceSecs, NextId, Paused)
//!   stored in **instance** storage (cheap, co-archived with the contract).
//! - `Stake` and `PriceConfig` stored in **persistent** storage with TTL
//!   extended on every write.
//!
//! TTL constants are expressed in ledgers.  One Stellar ledger ≈ 5 seconds.
//! The README allows max_window_secs up to ~7 days (604 800 s) plus a
//! configurable grace period (default 3 600 s).  We use a generous ceiling
//! so that a sweeper TTL-bump is only needed for very long-lived stakes.
//!
//! Chosen values:
//!   MAX_WINDOW_SECS  = 604 800 s  (7 days)
//!   MAX_GRACE_SECS   =  86 400 s  (1 day, conservative upper bound)
//!   SAFETY_BUFFER    =  86 400 s  (extra 1 day so sweeper has time to act)
//!   Total ceiling    = 777 600 s  = 155 520 ledgers  ≈ 18 days
//!
//! BUMP_AMOUNT: how many ledgers we extend TTL by on each touch.
//! We extend to the same ceiling so one bump always resets to the maximum.

use soroban_sdk::{Address, Env};

use crate::errors::Error;
use crate::types::{DataKey, PriceConfig, Stake, Status};

// ---------------------------------------------------------------------------
// TTL constants
// ---------------------------------------------------------------------------

/// Approximate seconds per ledger on Stellar mainnet / testnet.
const SECS_PER_LEDGER: u64 = 5;

/// Maximum reply window the contract supports (7 days in ledgers).
/// README "Getting started" example uses 604 800 s.
const MAX_WINDOW_LEDGERS: u32 = (7 * 24 * 3600 / SECS_PER_LEDGER) as u32; // 120 960

/// Upper-bound grace period (1 day in ledgers) — conservative; the actual
/// value is set at runtime via `grace_secs`, but we size TTL for the worst case.
const MAX_GRACE_LEDGERS: u32 = (24 * 3600 / SECS_PER_LEDGER) as u32; // 17 280

/// Safety buffer so the sweeper can still act before archival (1 day in ledgers).
const SAFETY_BUFFER_LEDGERS: u32 = (24 * 3600 / SECS_PER_LEDGER) as u32; // 17 280

/// TTL ceiling for persistent Stake / PriceConfig entries.
/// = MAX_WINDOW + MAX_GRACE + SAFETY_BUFFER  ≈ 18 days in ledgers.
pub const STAKE_TTL_THRESHOLD: u32 = MAX_WINDOW_LEDGERS + MAX_GRACE_LEDGERS + SAFETY_BUFFER_LEDGERS; // 155 520

/// Amount to extend by on each bump — set equal to the ceiling so one call
/// always resets to the maximum remaining life.
pub const STAKE_TTL_BUMP: u32 = STAKE_TTL_THRESHOLD;

// ---------------------------------------------------------------------------
// Initialization guard
// ---------------------------------------------------------------------------

/// Returns `true` if the contract has been initialized (Admin key present).
pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

// ---------------------------------------------------------------------------
// Instance-storage config helpers
// ---------------------------------------------------------------------------

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_oracle(env: &Env, oracle: &Address) {
    env.storage().instance().set(&DataKey::Oracle, oracle);
}

pub fn get_oracle(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Oracle)
        .ok_or(Error::NotInitialized)
}

pub fn set_treasury(env: &Env, treasury: &Address) {
    env.storage().instance().set(&DataKey::Treasury, treasury);
}

pub fn get_treasury(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Treasury)
        .ok_or(Error::NotInitialized)
}

pub fn set_fee_bps(env: &Env, fee_bps: u32) {
    env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
}

pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::FeeBps)
        .unwrap_or(0u32)
}

pub fn set_grace_secs(env: &Env, grace_secs: u64) {
    env.storage()
        .instance()
        .set(&DataKey::GraceSecs, &grace_secs);
}

pub fn get_grace_secs(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::GraceSecs)
        .unwrap_or(3600u64)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// ID allocation
// ---------------------------------------------------------------------------

/// Atomically read, increment, and return the next stake ID.
pub fn next_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::NextId)
        .unwrap_or(0u64);
    env.storage().instance().set(&DataKey::NextId, &(id + 1));
    id
}

// ---------------------------------------------------------------------------
// Persistent Stake storage
// ---------------------------------------------------------------------------

/// Persist a stake and extend its TTL.
///
/// README: "extends their TTL on every touch".
/// State is saved here so callers that do external transfers afterward
/// cannot re-enter into an inconsistent state (README security note).
pub fn save_stake(env: &Env, stake: &Stake) {
    let key = DataKey::Stake(stake.id);
    env.storage().persistent().set(&key, stake);
    env.storage()
        .persistent()
        .extend_ttl(&key, STAKE_TTL_THRESHOLD, STAKE_TTL_BUMP);
}

/// Load a stake, returning `Error::StakeNotFound` if absent.
pub fn load_stake(env: &Env, stake_id: u64) -> Result<Stake, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Stake(stake_id))
        .ok_or(Error::StakeNotFound)
}

/// Extend the TTL of an existing stake without mutating it.
/// Public helper called by the sweeper and the `extend_ttl` contract function.
pub fn bump_stake_ttl(env: &Env, stake_id: u64) -> Result<(), Error> {
    let key = DataKey::Stake(stake_id);
    if !env.storage().persistent().has(&key) {
        return Err(Error::StakeNotFound);
    }
    env.storage()
        .persistent()
        .extend_ttl(&key, STAKE_TTL_THRESHOLD, STAKE_TTL_BUMP);
    Ok(())
}

// ---------------------------------------------------------------------------
// Persistent PriceConfig storage
// ---------------------------------------------------------------------------

/// Default PriceConfig used when a recipient has not called `set_price`.
///
/// Defaults: min_amount = 1 USDC (7 decimals), windows = 1 hour to 30 days.
pub fn default_price_config() -> PriceConfig {
    PriceConfig {
        min_amount: 10_000_000, // 1 USDC
        min_window_secs: 3_600,
        max_window_secs: 30 * 24 * 3600,
    }
}

/// Save a recipient's price config and extend its TTL.
pub fn save_price(env: &Env, recipient: &Address, cfg: &PriceConfig) {
    let key = DataKey::Price(recipient.clone());
    env.storage().persistent().set(&key, cfg);
    env.storage()
        .persistent()
        .extend_ttl(&key, STAKE_TTL_THRESHOLD, STAKE_TTL_BUMP);
}

/// Load a recipient's price config, falling back to the default if unset.
/// README: `get_price_or_default`.
pub fn get_price_or_default(env: &Env, recipient: &Address) -> PriceConfig {
    env.storage()
        .persistent()
        .get(&DataKey::Price(recipient.clone()))
        .unwrap_or_else(default_price_config)
}

// ---------------------------------------------------------------------------
// Fee math
// ---------------------------------------------------------------------------

/// Split `amount` into (to_sender, fee) using `fee_bps`.
///
/// Fee is rounded **down** (integer division), so rounding always favours
/// the sender (README: "fee rounding in favor of the sender").
pub fn split_fee(env: &Env, amount: i128) -> (i128, i128) {
    let fee_bps = get_fee_bps(env) as i128;
    let fee = (amount * fee_bps) / 10_000; // floor division
    (amount - fee, fee)
}

// ---------------------------------------------------------------------------
// Helpers used in lib.rs
// ---------------------------------------------------------------------------

/// Assert the contract is not paused; return `Error::Paused` otherwise.
pub fn assert_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        Err(Error::Paused)
    } else {
        Ok(())
    }
}

/// Assert the contract has been initialized; return `Error::NotInitialized` otherwise.
pub fn assert_initialized(env: &Env) -> Result<(), Error> {
    if is_initialized(env) {
        Ok(())
    } else {
        Err(Error::NotInitialized)
    }
}

/// Assert a stake's status is Pending; return `Error::NotPending` otherwise.
pub fn assert_pending(stake: &Stake) -> Result<(), Error> {
    if stake.status == Status::Pending {
        Ok(())
    } else {
        Err(Error::NotPending)
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EscrowContract;
    use soroban_sdk::{testutils::Address as _, BytesN, Env};

    fn make_env() -> (Env, soroban_sdk::Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        (env, contract_id)
    }

    // ------------------------------------------------------------------
    // Helpers for constructing test stakes
    // ------------------------------------------------------------------

    fn dummy_stake(env: &Env, id: u64) -> Stake {
        Stake {
            id,
            sender: Address::generate(env),
            recipient: Address::generate(env),
            token: Address::generate(env),
            amount: 50_000_000,
            msg_hash: BytesN::from_array(env, &[0u8; 32]),
            created_at: env.ledger().timestamp(),
            deadline: env.ledger().timestamp() + 86400,
            status: Status::Pending,
        }
    }

    // ------------------------------------------------------------------
    // is_initialized / set_admin / get_admin
    // ------------------------------------------------------------------

    #[test]
    fn test_not_initialized_before_set_admin() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            assert!(!is_initialized(&env));
            assert_eq!(get_admin(&env), Err(Error::NotInitialized));
        });
    }

    #[test]
    fn test_initialized_after_set_admin() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            let addr = Address::generate(&env);
            set_admin(&env, &addr);
            assert!(is_initialized(&env));
            assert_eq!(get_admin(&env).unwrap(), addr);
        });
    }

    // ------------------------------------------------------------------
    // Oracle / Treasury / FeeBps / GraceSecs
    // ------------------------------------------------------------------

    #[test]
    fn test_oracle_round_trip() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            let addr = Address::generate(&env);
            set_oracle(&env, &addr);
            assert_eq!(get_oracle(&env).unwrap(), addr);
        });
    }

    #[test]
    fn test_treasury_round_trip() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            let addr = Address::generate(&env);
            set_treasury(&env, &addr);
            assert_eq!(get_treasury(&env).unwrap(), addr);
        });
    }

    #[test]
    fn test_fee_bps_defaults_to_zero() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            assert_eq!(get_fee_bps(&env), 0);
        });
    }

    #[test]
    fn test_fee_bps_round_trip() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            set_fee_bps(&env, 100);
            assert_eq!(get_fee_bps(&env), 100);
        });
    }

    #[test]
    fn test_grace_secs_defaults_to_3600() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            assert_eq!(get_grace_secs(&env), 3600);
        });
    }

    #[test]
    fn test_grace_secs_round_trip() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            set_grace_secs(&env, 7200);
            assert_eq!(get_grace_secs(&env), 7200);
        });
    }

    // ------------------------------------------------------------------
    // Paused flag
    // ------------------------------------------------------------------

    #[test]
    fn test_paused_defaults_to_false() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            assert!(!is_paused(&env));
        });
    }

    #[test]
    fn test_pause_toggle() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            set_paused(&env, true);
            assert!(is_paused(&env));
            set_paused(&env, false);
            assert!(!is_paused(&env));
        });
    }

    // ------------------------------------------------------------------
    // next_id
    // ------------------------------------------------------------------

    #[test]
    fn test_next_id_starts_at_zero_and_increments() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            assert_eq!(next_id(&env), 0);
            assert_eq!(next_id(&env), 1);
            assert_eq!(next_id(&env), 2);
        });
    }

    // ------------------------------------------------------------------
    // save_stake / load_stake / bump_stake_ttl
    // ------------------------------------------------------------------

    #[test]
    fn test_save_and_load_stake() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            let stake = dummy_stake(&env, 0);
            save_stake(&env, &stake);
            let loaded = load_stake(&env, 0).unwrap();
            assert_eq!(loaded.id, 0);
            assert_eq!(loaded.amount, 50_000_000);
            assert_eq!(loaded.status, Status::Pending);
        });
    }

    #[test]
    fn test_load_missing_stake_returns_not_found() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            assert_eq!(load_stake(&env, 99), Err(Error::StakeNotFound));
        });
    }

    #[test]
    fn test_bump_stake_ttl_missing_returns_not_found() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            assert_eq!(bump_stake_ttl(&env, 42), Err(Error::StakeNotFound));
        });
    }

    #[test]
    fn test_bump_stake_ttl_present_returns_ok() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            let stake = dummy_stake(&env, 5);
            save_stake(&env, &stake);
            assert_eq!(bump_stake_ttl(&env, 5), Ok(()));
        });
    }

    // ------------------------------------------------------------------
    // save_price / get_price_or_default
    // ------------------------------------------------------------------

    #[test]
    fn test_price_defaults_when_not_set() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            let addr = Address::generate(&env);
            let cfg = get_price_or_default(&env, &addr);
            assert_eq!(cfg.min_amount, 10_000_000); // 1 USDC
            assert_eq!(cfg.min_window_secs, 3_600);
            assert_eq!(cfg.max_window_secs, 30 * 24 * 3600);
        });
    }

    #[test]
    fn test_price_round_trip() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            let addr = Address::generate(&env);
            let cfg = PriceConfig {
                min_amount: 50_000_000,
                min_window_secs: 3_600,
                max_window_secs: 604_800,
            };
            save_price(&env, &addr, &cfg);
            let loaded = get_price_or_default(&env, &addr);
            assert_eq!(loaded.min_amount, 50_000_000);
            assert_eq!(loaded.min_window_secs, 3_600);
            assert_eq!(loaded.max_window_secs, 604_800);
        });
    }

    // ------------------------------------------------------------------
    // split_fee
    // ------------------------------------------------------------------

    #[test]
    fn test_split_fee_zero_bps() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            set_fee_bps(&env, 0);
            let (to_sender, fee) = split_fee(&env, 100_000_000);
            assert_eq!(to_sender, 100_000_000);
            assert_eq!(fee, 0);
        });
    }

    #[test]
    fn test_split_fee_100_bps_exact() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            set_fee_bps(&env, 100); // 1%
            let (to_sender, fee) = split_fee(&env, 100_000_000);
            assert_eq!(fee, 1_000_000);
            assert_eq!(to_sender, 99_000_000);
            assert_eq!(to_sender + fee, 100_000_000);
        });
    }

    #[test]
    fn test_split_fee_500_bps_hard_cap() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            set_fee_bps(&env, 500); // 5% hard cap
            let (to_sender, fee) = split_fee(&env, 10_000_000);
            assert_eq!(fee, 500_000);
            assert_eq!(to_sender, 9_500_000);
            assert_eq!(to_sender + fee, 10_000_000);
        });
    }

    #[test]
    fn test_split_fee_rounds_down_favoring_sender() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            set_fee_bps(&env, 100); // 1%
                                    // 7 base units: fee = floor(7 * 100 / 10000) = floor(0.07) = 0
            let (to_sender, fee) = split_fee(&env, 7);
            assert_eq!(fee, 0);
            assert_eq!(to_sender, 7);
        });
    }

    // ------------------------------------------------------------------
    // assert_not_paused / assert_initialized / assert_pending
    // ------------------------------------------------------------------

    #[test]
    fn test_assert_not_paused_passes_when_unpaused() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            assert_eq!(assert_not_paused(&env), Ok(()));
        });
    }

    #[test]
    fn test_assert_not_paused_fails_when_paused() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            set_paused(&env, true);
            assert_eq!(assert_not_paused(&env), Err(Error::Paused));
        });
    }

    #[test]
    fn test_assert_initialized_fails_before_init() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            assert_eq!(assert_initialized(&env), Err(Error::NotInitialized));
        });
    }

    #[test]
    fn test_assert_initialized_passes_after_set_admin() {
        let (env, cid) = make_env();
        env.as_contract(&cid, || {
            let addr = Address::generate(&env);
            set_admin(&env, &addr);
            assert_eq!(assert_initialized(&env), Ok(()));
        });
    }

    #[test]
    fn test_assert_pending_pending_stake() {
        let env = Env::default();
        let stake = Stake {
            id: 0,
            sender: Address::generate(&env),
            recipient: Address::generate(&env),
            token: Address::generate(&env),
            amount: 50_000_000,
            msg_hash: BytesN::from_array(&env, &[0u8; 32]),
            created_at: 0,
            deadline: 86400,
            status: Status::Pending,
        };
        assert_eq!(assert_pending(&stake), Ok(()));
    }

    #[test]
    fn test_assert_pending_refunded_stake() {
        let env = Env::default();
        let mut stake = Stake {
            id: 0,
            sender: Address::generate(&env),
            recipient: Address::generate(&env),
            token: Address::generate(&env),
            amount: 50_000_000,
            msg_hash: BytesN::from_array(&env, &[0u8; 32]),
            created_at: 0,
            deadline: 86400,
            status: Status::Pending,
        };
        stake.status = Status::Refunded;
        assert_eq!(assert_pending(&stake), Err(Error::NotPending));
    }

    #[test]
    fn test_assert_pending_claimed_stake() {
        let env = Env::default();
        let mut stake = Stake {
            id: 0,
            sender: Address::generate(&env),
            recipient: Address::generate(&env),
            token: Address::generate(&env),
            amount: 50_000_000,
            msg_hash: BytesN::from_array(&env, &[0u8; 32]),
            created_at: 0,
            deadline: 86400,
            status: Status::Pending,
        };
        stake.status = Status::Claimed;
        assert_eq!(assert_pending(&stake), Err(Error::NotPending));
    }
}
