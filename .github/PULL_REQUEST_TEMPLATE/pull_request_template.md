## Description

<!-- What does this PR do? Why? -->

## Changes

<!-- Bullet-point summary of files changed -->

## Security Implications

<!-- Any auth, key management, or fund-handling changes? -->

## Testing

<!-- How were the changes tested? Paste test output or CI link. -->

## README Alignment

<!-- List every README statement, function name, table, route, or invariant this PR touches and confirm it matches. -->

- [ ] **README alignment confirmed**: All contract functions, data types, errors, database tables, API routes, environment variables, and folder structures strictly match `README.md` verbatim without diverging.
- [ ] Any necessary README clarifications are included as minimal, explicit edits in this PR.

## Checklist

- [ ] `cargo fmt` passes
- [ ] `cargo clippy -- -D warnings` passes
- [ ] `cargo test` passes (contracts, including negative tests for all error branches)
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm test:integration` passes (E2E suite)
- [ ] No new folders or dependencies not implied by README
- [ ] Conventional Commit message used for every commit
