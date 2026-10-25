//! types.rs – on-chain data types for the Stellar Postage escrow contract.
//!
//! All names match the README "Smart Contract Specification → Data types" section
//! exactly. Any deviation from those names is a bug.

#![allow(clippy::derive_partial_eq_without_eq)] // soroban derives do not generate Eq always

use soroban_sdk::{contracttype, Address, BytesN};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/// Lifecycle state of a stake.
///
/// README invariant 1: a stake leaves Pending at most once.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Pending,
    Refunded,
    Claimed,
}

// ---------------------------------------------------------------------------
// Stake
// ---------------------------------------------------------------------------

/// A single staked message escrow record.
///
/// Stored in persistent storage keyed by `DataKey::Stake(id)`.
/// Only `msg_hash` goes on-chain; the message body lives off-chain
/// (README: "Off-chain messages, on-chain proof").
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Stake {
    /// Sequential on-chain identifier (monotonically increasing from 0).
    pub id: u64,
    /// Address that sent the message and will receive the refund.
    pub sender: Address,
    /// Address of the recipient who set the price.
    pub recipient: Address,
    /// USDC Stellar Asset Contract address.
    pub token: Address,
    /// Stake amount in token base units (USDC has 7 decimals on Stellar).
    pub amount: i128,
    /// SHA-256 hash of the off-chain message payload (32 bytes).
    pub msg_hash: BytesN<32>,
    /// Ledger timestamp at creation (Unix seconds).
    pub created_at: u64,
    /// Ledger timestamp after which `claim` is allowed (plus `grace_secs`).
    pub deadline: u64,
    /// Current lifecycle state.
    pub status: Status,
}

// ---------------------------------------------------------------------------
// PriceConfig
// ---------------------------------------------------------------------------

/// Per-recipient pricing settings stored in persistent storage.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceConfig {
    /// Minimum stake amount the recipient will accept (token base units).
    pub min_amount: i128,
    /// Minimum reply-window the sender may choose (seconds).
    pub min_window_secs: u64,
    /// Maximum reply-window the sender may choose (seconds).
    pub max_window_secs: u64,
}

// ---------------------------------------------------------------------------
// DataKey
// ---------------------------------------------------------------------------

/// Storage keys used throughout the contract.
///
/// Config keys (Admin, Oracle, Treasury, FeeBps, GraceSecs, NextId, Paused)
/// live in **instance** storage.
///
/// Per-recipient Price and per-stake Stake records live in **persistent**
/// storage with TTL extension on every write.
#[contracttype]
pub enum DataKey {
    /// The admin address (may rotate oracle and fee).
    Admin,
    /// The oracle address (may call `confirm_reply`).
    Oracle,
    /// Treasury address that receives protocol fees.
    Treasury,
    /// Protocol fee in basis points (0–500, hard cap 5%).
    FeeBps,
    /// Seconds of grace after a stake's deadline before `claim` is allowed.
    GraceSecs,
    /// Monotonically increasing counter for stake IDs.
    NextId,
    /// Boolean pause flag; when true, new `send` calls are rejected.
    Paused,
    /// Per-recipient pricing configuration.
    Price(Address),
    /// Per-stake record.
    Stake(u64),
}
