//! lib.rs – Stellar Postage escrow contract entrypoints.
//!
//! A single Soroban contract instance serves all users.  USDC is held via the
//! Stellar Asset Contract (SAC).  All public function names, parameter names,
//! event names, and error codes match the README "Smart Contract Specification"
//! section verbatim.
//!
//! README invariants enforced here:
//!  1. A stake leaves Pending at most once.
//!  2. Total USDC held equals sum of Pending stake amounts.
//!  3. Only the oracle can trigger a refund; only recipient (or time) a payout.
//!  4. `claim` cannot succeed before `deadline + grace_secs`.
//!  5. `confirm_reply` and `claim` are mutually exclusive on the same stake.
//!  6. Fee never exceeds the hard cap (500 bps = 5%).
//!  7. Pausing never blocks settlement of existing stakes.

#![no_std]

mod errors;
mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractevent, contractimpl, symbol_short, token, Address, BytesN, Env,
};

pub use errors::Error;
pub use types::{DataKey, PriceConfig, Stake, Status};

use storage::{
    assert_initialized, assert_not_paused, assert_pending, bump_stake_ttl, get_grace_secs,
    get_oracle, get_price_or_default, get_treasury, is_initialized, load_stake, next_id,
    save_price, save_stake, set_admin, set_fee_bps, set_grace_secs, set_oracle, set_paused,
    set_treasury, split_fee,
};

/// Hard cap on `fee_bps`: 500 = 5%.  README: "hard cap 5%".
pub const MAX_FEE_BPS: u32 = 500;

// ---------------------------------------------------------------------------
// Contract events – using #[contractevent] as required by soroban-sdk 29.
//
// README event table:
//   sent    | ("sent", stake_id)      | Full Stake
//   replied | ("replied", stake_id)   | none
//   spam    | ("spam", stake_id)      | none
//   claimed | ("claimed", stake_id)   | none
//   price   | ("price", recipient)    | PriceConfig
// ---------------------------------------------------------------------------

#[contractevent]
#[derive(Clone, Debug)]
pub struct SentEvent {
    #[topic]
    pub name: soroban_sdk::Symbol,
    #[topic]
    pub stake_id: u64,
    pub stake: Stake,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct RepliedEvent {
    #[topic]
    pub name: soroban_sdk::Symbol,
    #[topic]
    pub stake_id: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SpamEvent {
    #[topic]
    pub name: soroban_sdk::Symbol,
    #[topic]
    pub stake_id: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct ClaimedEvent {
    #[topic]
    pub name: soroban_sdk::Symbol,
    #[topic]
    pub stake_id: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct PriceEvent {
    #[topic]
    pub name: soroban_sdk::Symbol,
    #[topic]
    pub recipient: Address,
    pub config: PriceConfig,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    /// Set contract roles and parameters.  May only be called once.
    ///
    /// README: `initialize(admin, oracle, treasury, fee_bps, grace_secs)` –
    /// Deployer, once.
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle: Address,
        treasury: Address,
        fee_bps: u32,
        grace_secs: u64,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::FeeTooHigh);
        }
        set_admin(&env, &admin);
        set_oracle(&env, &oracle);
        set_treasury(&env, &treasury);
        set_fee_bps(&env, fee_bps);
        set_grace_secs(&env, grace_secs);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Pricing
    // -----------------------------------------------------------------------

    /// Set the minimum stake and allowed reply windows for a recipient.
    ///
    /// README: `set_price(recipient, min_amount, min_window, max_window)` –
    /// Recipient (`require_auth`).  Emits `("price", recipient)` event.
    pub fn set_price(
        env: Env,
        recipient: Address,
        min_amount: i128,
        min_window: u64,
        max_window: u64,
    ) -> Result<(), Error> {
        assert_initialized(&env)?;
        recipient.require_auth();

        if min_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if min_window > max_window {
            return Err(Error::WindowOutOfRange);
        }

        let cfg = PriceConfig {
            min_amount,
            min_window_secs: min_window,
            max_window_secs: max_window,
        };
        save_price(&env, &recipient, &cfg);

        // README event: `("price", recipient)` -> PriceConfig
        PriceEvent {
            name: symbol_short!("price"),
            recipient,
            config: cfg,
        }
        .publish(&env);
        Ok(())
    }

    /// Read-only: return the recipient's price config (or the default).
    ///
    /// README: `get_price(recipient) -> PriceConfig` – Anyone.
    pub fn get_price(env: Env, recipient: Address) -> PriceConfig {
        get_price_or_default(&env, &recipient)
    }

    // -----------------------------------------------------------------------
    // Send (stake creation)
    // -----------------------------------------------------------------------

    /// Validate against recipient price, pull USDC into escrow, create stake.
    ///
    /// README: `send(sender, recipient, token, amount, msg_hash, window_secs) -> u64` –
    /// Sender (`require_auth`).  Emits `("sent", stake_id)` with full `Stake`.
    pub fn send(
        env: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        amount: i128,
        msg_hash: BytesN<32>,
        window_secs: u64,
    ) -> Result<u64, Error> {
        assert_initialized(&env)?;
        assert_not_paused(&env)?;
        sender.require_auth();

        // README: "add checks for `amount > 0`, self-sends"
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if sender == recipient {
            return Err(Error::InvalidAmount);
        }

        let price = get_price_or_default(&env, &recipient);
        if amount < price.min_amount {
            return Err(Error::BelowMinimum);
        }
        if window_secs < price.min_window_secs || window_secs > price.max_window_secs {
            return Err(Error::WindowOutOfRange);
        }

        // Pull funds into escrow.
        #[allow(clippy::needless_borrows_for_generic_args)]
        token::Client::new(&env, &token).transfer(
            &sender,
            &env.current_contract_address(),
            &amount,
        );

        let id = next_id(&env);
        let now = env.ledger().timestamp();
        let stake = Stake {
            id,
            sender,
            recipient,
            token,
            amount,
            msg_hash,
            created_at: now,
            deadline: now + window_secs,
            status: Status::Pending,
        };

        // README: "State must be saved before any external call where possible."
        save_stake(&env, &stake);

        // README event: `("sent", stake_id)` -> full Stake
        SentEvent {
            name: symbol_short!("sent"),
            stake_id: id,
            stake: stake.clone(),
        }
        .publish(&env);

        Ok(id)
    }

    // -----------------------------------------------------------------------
    // Oracle: confirm reply
    // -----------------------------------------------------------------------

    /// Oracle attests that the recipient replied.  Refunds sender minus fee.
    ///
    /// README: `confirm_reply(stake_id)` – Oracle.
    /// Emits `("replied", stake_id)`.
    pub fn confirm_reply(env: Env, stake_id: u64) -> Result<(), Error> {
        assert_initialized(&env)?;

        let oracle = get_oracle(&env)?;
        oracle.require_auth();

        let mut stake = load_stake(&env, stake_id)?;
        assert_pending(&stake)?;

        // README: "Replies must be confirmed before the grace period ends, so
        // claim() cannot race it."
        let grace = get_grace_secs(&env);
        if env.ledger().timestamp() > stake.deadline + grace {
            return Err(Error::TooLate);
        }

        let (to_sender, fee) = split_fee(&env, stake.amount);
        let tok = token::Client::new(&env, &stake.token);

        // README invariant: state set before external transfers to prevent reentrancy.
        stake.status = Status::Refunded;
        save_stake(&env, &stake);

        tok.transfer(&env.current_contract_address(), &stake.sender, &to_sender);
        if fee > 0 {
            let treasury = get_treasury(&env)?;
            tok.transfer(&env.current_contract_address(), &treasury, &fee);
        }

        // README event: `("replied", stake_id)` -> none
        RepliedEvent {
            name: symbol_short!("replied"),
            stake_id,
        }
        .publish(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Recipient: flag spam
    // -----------------------------------------------------------------------

    /// Recipient marks the message as spam; pays out immediately.
    ///
    /// README: `flag_spam(stake_id)` – Recipient.
    /// Emits `("spam", stake_id)`.
    pub fn flag_spam(env: Env, stake_id: u64) -> Result<(), Error> {
        assert_initialized(&env)?;

        let mut stake = load_stake(&env, stake_id)?;
        assert_pending(&stake)?;

        stake.recipient.clone().require_auth();

        let (to_recipient, fee) = split_fee(&env, stake.amount);
        let tok = token::Client::new(&env, &stake.token);

        // State before transfers (reentrancy guard).
        stake.status = Status::Claimed;
        save_stake(&env, &stake);

        tok.transfer(
            &env.current_contract_address(),
            &stake.recipient,
            &to_recipient,
        );
        if fee > 0 {
            let treasury = get_treasury(&env)?;
            tok.transfer(&env.current_contract_address(), &treasury, &fee);
        }

        // README event: `("spam", stake_id)` -> none
        SpamEvent {
            name: symbol_short!("spam"),
            stake_id,
        }
        .publish(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Anyone: claim after deadline
    // -----------------------------------------------------------------------

    /// After `deadline + grace_secs`, anyone may trigger payout to the recipient.
    ///
    /// README: `claim(stake_id)` – Anyone.  After `deadline + grace`, pays
    /// recipient if still Pending.  Emits `("claimed", stake_id)`.
    pub fn claim(env: Env, stake_id: u64) -> Result<(), Error> {
        assert_initialized(&env)?;

        let mut stake = load_stake(&env, stake_id)?;
        assert_pending(&stake)?;

        let grace = get_grace_secs(&env);
        if env.ledger().timestamp() <= stake.deadline + grace {
            return Err(Error::DeadlineNotReached);
        }

        let (to_recipient, fee) = split_fee(&env, stake.amount);
        let tok = token::Client::new(&env, &stake.token);

        // State before transfers (reentrancy guard).
        stake.status = Status::Claimed;
        save_stake(&env, &stake);

        tok.transfer(
            &env.current_contract_address(),
            &stake.recipient,
            &to_recipient,
        );
        if fee > 0 {
            let treasury = get_treasury(&env)?;
            tok.transfer(&env.current_contract_address(), &treasury, &fee);
        }

        // README event: `("claimed", stake_id)` -> none
        ClaimedEvent {
            name: symbol_short!("claimed"),
            stake_id,
        }
        .publish(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Read-only
    // -----------------------------------------------------------------------

    /// README: `get_stake(stake_id) -> Stake` – Anyone.
    pub fn get_stake(env: Env, stake_id: u64) -> Result<Stake, Error> {
        load_stake(&env, stake_id)
    }

    // -----------------------------------------------------------------------
    // Admin: oracle rotation
    // -----------------------------------------------------------------------

    /// Rotate the oracle key.
    ///
    /// README: `set_oracle(new_oracle)` – Admin.
    pub fn set_oracle(env: Env, new_oracle: Address) -> Result<(), Error> {
        assert_initialized(&env)?;
        let admin = storage::get_admin(&env)?;
        admin.require_auth();
        set_oracle(&env, &new_oracle);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Admin: fee update
    // -----------------------------------------------------------------------

    /// Update the protocol fee.  Cap enforced: max 500 bps (5%).
    ///
    /// README: `set_fee(fee_bps)` – Admin.
    pub fn set_fee(env: Env, fee_bps: u32) -> Result<(), Error> {
        assert_initialized(&env)?;
        let admin = storage::get_admin(&env)?;
        admin.require_auth();
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::FeeTooHigh);
        }
        set_fee_bps(&env, fee_bps);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Admin: pause / unpause
    // -----------------------------------------------------------------------

    /// Block new `send` calls.  Existing stakes can always settle.
    ///
    /// README: `pause()` – Admin.
    /// README invariant 7: "Pausing never blocks settlement of existing stakes."
    pub fn pause(env: Env) -> Result<(), Error> {
        assert_initialized(&env)?;
        let admin = storage::get_admin(&env)?;
        admin.require_auth();
        set_paused(&env, true);
        Ok(())
    }

    /// Re-enable new `send` calls.
    ///
    /// README: `unpause()` – Admin.
    pub fn unpause(env: Env) -> Result<(), Error> {
        assert_initialized(&env)?;
        let admin = storage::get_admin(&env)?;
        admin.require_auth();
        set_paused(&env, false);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Public: TTL extension helper
    // -----------------------------------------------------------------------

    /// Extend the TTL of a stake record.  Callable by anyone (useful for the
    /// sweeper).
    ///
    /// README: "Lets anyone call an `extend_ttl(stake_id)` helper".
    pub fn extend_ttl(env: Env, stake_id: u64) -> Result<(), Error> {
        bump_stake_ttl(&env, stake_id)
    }
}
