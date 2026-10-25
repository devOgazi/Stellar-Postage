//! errors.rs – typed error enum for the escrow contract.
//!
//! Variants and discriminants match the README "Smart Contract Specification
//! → Errors" section verbatim. Do not renumber or rename.

use soroban_sdk::contracterror;

/// All error codes the escrow contract may return.
///
/// Using `#[contracterror]` ensures these are propagated as typed Soroban
/// errors rather than panics.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// Contract has not been initialized yet.
    NotInitialized = 1,
    /// `initialize` was called a second time.
    AlreadyInitialized = 2,
    /// Contract is paused; new `send` calls are rejected.
    Paused = 3,
    /// Stake amount is below the recipient's `min_amount`.
    BelowMinimum = 4,
    /// `window_secs` is outside the recipient's `[min_window_secs, max_window_secs]`.
    WindowOutOfRange = 5,
    /// No stake exists for the given `stake_id`.
    StakeNotFound = 6,
    /// Operation requires `Pending` status but the stake is in a terminal state.
    NotPending = 7,
    /// `claim` was called before `deadline + grace_secs`.
    DeadlineNotReached = 8,
    /// `confirm_reply` was called after `deadline + grace_secs`.
    TooLate = 9,
    /// Amount is zero or negative.
    InvalidAmount = 10,
    /// Proposed `fee_bps` exceeds the hard cap of 500 (5%).
    FeeTooHigh = 11,
}
