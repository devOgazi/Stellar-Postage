# Contributing to Stellar Postage

Thank you for your interest in contributing!

Please read **[README.md](./README.md)** in full before submitting code.
The README is the single source of truth for architecture, naming, scope,
and security model.

## Quick-start

```bash
git clone https://github.com/<your-username>/stellar-postage.git
cd stellar-postage
pnpm install
```

## Development workflow

1. Fork the repository and create a feature branch off `main`.
2. Keep contract changes small and fully tested, including negative cases.
3. Run `cargo fmt`, `cargo clippy -- -D warnings`, and `pnpm lint` before
   opening a PR.
4. Describe the problem, the approach, and any security implications in the PR
   (use the PR template).
5. Use [Conventional Commits](https://www.conventionalcommits.org/) for every
   commit message.

## Contract changes

- Every new function must have tests for all validation branches, including
  the negative/error cases.
- Every README invariant must map to at least one test.
- Use typed `Error` variants (`#[contracterror]`), never `panic!` or bare
  `assert!` in production paths.
- Run `cd contracts/escrow && cargo test` before pushing.

## TypeScript changes

- Run `pnpm typecheck` and `pnpm lint` before pushing.
- Match naming exactly: function names, table names, API routes, env var names
  all come from README.md.

## Security issues

**Do not** open public GitHub issues for security vulnerabilities.
Email [devogazi@gmail.com](mailto:devogazi@gmail.com) instead.

## Out of scope

The following are explicitly out of scope until roadmap phases advance:
- Mainnet deployment
- Threshold oracle / multisig signing
- Zero-knowledge email proofs
- Dispute resolution path
- Passkey smart wallets
- Additional channels (Discord, X, LinkedIn, etc.)

## License

By contributing you agree your work is licensed under [MIT](./LICENSE).
