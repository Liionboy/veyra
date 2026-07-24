# Contributing to Veyra

Thank you for helping improve Veyra.

## Before opening a change

- Use a GitHub issue for substantial behavior or architecture changes.
- Use private vulnerability reporting for security issues.
- Keep Veyra's single-node, self-hosted scope in mind.
- Do not copy code from Pingvin Share or Pingvin Share X.

## Development setup

Requirements: Node.js 22.13 or newer and npm.

```bash
npm ci
npm run dev
```

Before submitting:

```bash
npm run check
npm audit --audit-level=high
```

## Change expectations

- Add tests for security boundaries, migrations, storage, and upload behavior.
- Treat filenames, paths, MIME types, IP addresses, and identity claims as
  untrusted input.
- Keep public tokens out of logs and persisted plaintext.
- Preserve owner scoping in every personal query.
- Keep global administration aggregate-only unless a future design explicitly
  introduces audited content-access consent.
- Update README, SECURITY, and CHANGELOG when behavior changes.
- Avoid introducing background services that materially increase the default
  deployment footprint.

## Pull requests

Describe the problem, the chosen approach, test evidence, migration impact, and
security implications. Keep unrelated refactors out of the same pull request.

By contributing, you agree that your contribution is licensed under the MIT
License.
