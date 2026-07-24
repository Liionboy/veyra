# Changelog

All notable changes to Veyra are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-07-25

### Added

- Resumable file and folder uploads with offset validation, progress, speed,
  ETA, pause, and resume
- Atomic per-user and instance quota reservations with a local free-space guard
- QR codes, safe inline previews, direct links, Range requests, and streamed
  download-all ZIP archives
- Reverse upload requests and owner-only submission inboxes
- Controlled branding and safe raster logo re-encoding
- Expiring invitation onboarding and aggregate-only global administration
- Fail-closed ClamAV scanning and quarantine
- OIDC Authorization Code + PKCE with explicit account linking
- Local and S3-compatible object storage
- Durable object-deletion retries and safe S3-to-local backend switching
- Crash reconciliation for resumable offsets and idempotent completion effects
- Sequential lazy streaming for large download-all archives
- Multi-user authentication, TOTP, recovery codes, email verification, password
  recovery, SMTP delivery, and account suspension
- Six responsive themes

### Security

- High-entropy hash-only public capabilities
- AES-256-GCM protection for recoverable links and integration secrets
- Path normalization, opaque object keys, ZIP traversal prevention, CSP,
  rate limits, and privacy-preserving audit events

[1.0.0]: https://github.com/Liionboy/veyra/releases/tag/v1.0.0
