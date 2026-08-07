# Changelog

All notable changes to Veyra are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/).

## [1.1.2] - 2026-08-07

### Fixed

- Health and public configuration endpoints now derive the application version
  from package metadata instead of a stale hardcoded value
- The web fallback configuration uses the same package version, preventing
  release metadata from drifting across the server and client

## [1.1.1] - 2026-08-07

### Security

- Security-related request failures now include the HTTP method, query-free
  path, client IP, and response status in structured server logs
- Query strings are excluded from failure logs to prevent accidental exposure
  of tokens or other sensitive URL parameters
- Updated `brace-expansion` and `fast-uri` transitive dependencies to address
  high-severity denial-of-service and URL host-confusion advisories

## [1.1.0] - 2026-07-25

### Added

- Cryptographically secure share-password generator with one-click copy
- Explicit, disabled-by-default option to include a share password in the
  initial recipient email
- Success-screen password copy while the value remains available in the
  current browser tab

### Security

- Share passwords remain hash-only at rest; an email password is submitted
  only during finalization, verified against the stored `scrypt` hash, and
  never retained in recoverable form
- Manual email retries remain link-only, and password-bearing email content is
  HTML-escaped and excluded from subjects, URLs, responses, storage, and audit
  events

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

[1.1.2]: https://github.com/Liionboy/veyra/releases/tag/v1.1.2
[1.1.1]: https://github.com/Liionboy/veyra/releases/tag/v1.1.1
[1.1.0]: https://github.com/Liionboy/veyra/releases/tag/v1.1.0
[1.0.0]: https://github.com/Liionboy/veyra/releases/tag/v1.0.0
