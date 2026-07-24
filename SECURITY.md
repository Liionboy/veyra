# Security Policy

## Supported versions

Security updates are provided for the latest published Veyra release.

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| < 1.0 | No |

## Reporting a vulnerability

Please do not open a public issue containing exploit details, credentials,
private links, or uploaded content.

Use GitHub's private vulnerability reporting feature on this repository. Include
the affected version, deployment topology, reproduction steps, expected impact,
and any relevant sanitized logs. You should receive an acknowledgement within
seven days.

## Security model

A public share URL is a bearer capability. Possession of an unprotected URL
authorizes access until the share expires, is explicitly revoked, or reaches
its download limit. A share password adds a 15-minute, HMAC-authenticated grant
scoped to that share.

Reverse-share submissions are separate private inbox records. They are never
represented as hidden public shares, and the anonymous upload token is scoped
to one incomplete upload session.

### Identity and secrets

- Public share, invitation, reset, verification, upload, and session tokens use
  cryptographically secure randomness.
- Capability lookup values are stored as SHA-256 hashes. Links that must remain
  recoverable to their owner or administrator are separately encrypted with
  AES-256-GCM.
- Automatic access logging is disabled so bearer tokens and OIDC callback
  parameters embedded in URLs are not written to application logs.
- Local passwords use salted `scrypt` and constant-time comparison.
- TOTP secrets, SMTP passwords, S3 secrets, and OIDC client secrets are
  encrypted with an instance-secret-derived key.
- TOTP recovery codes are stored as keyed hashes and consumed once.
- Session cookies are `HttpOnly`, `SameSite=Strict`, seven-day capabilities.
  Production deployments must also enable the `Secure` flag.
- Password resets expire after 30 minutes and revoke all existing sessions.
- OIDC uses Authorization Code with PKCE, state, and nonce. Veyra does not
  auto-link accounts by matching email addresses.

### Upload and storage

- The client declares a complete manifest before content upload.
- Per-file, per-share, per-user, and instance limits are enforced server-side.
- Quota is reserved atomically in SQLite before the upload is accepted.
- A configurable free-space reserve is checked before reservation and before
  every chunk write.
- Chunks use exact compare-and-swap offsets; overlapping or replayed chunks are
  rejected.
- User paths are normalized, cannot contain traversal segments, and never
  become filesystem paths or S3 keys.
- Local and S3 objects use opaque UUID keys.
- SHA-256 is computed from staged bytes before publication.
- ZIP entry paths are normalized again to prevent Zip Slip.
- Abandoned sessions expire and release their reservations.
- Disk offsets are reconciled with SQLite after interruption, and processing
  sessions can resume finalization after a process restart.
- Object removals are recorded in a durable outbox before metadata deletion
  and retried with bounded backoff.

### Malware quarantine

When ClamAV is enabled, Veyra uses the `clamd` INSTREAM protocol and does not
execute shell commands with user filenames.

The publication state is:

```text
uploading → processing → scanning → ready
                              └──→ quarantined
```

Only `ready` objects can be previewed, downloaded, emailed, or listed in a
public share. Malware detection, scanner timeout, scanner rejection, or
connectivity failure quarantines the complete upload. The feature is therefore
fail-closed.

### Browser and HTTP controls

- Content Security Policy with no external script sources
- `X-Content-Type-Options: nosniff`
- clickjacking protection and restrictive referrer policy
- optional HSTS when secure cookies are enabled
- route-specific and global request throttling
- safe inline preview allowlist; HTML and SVG are never served inline
- sandboxed preview frames and Range support for media/PDF
- `no-store` on sensitive metadata, grants, previews, and files

### Authorization and administrator privacy

- Every personal management query is scoped by the authenticated `owner_id`.
- Members cannot modify instance, identity, storage, scanner, SMTP, or branding
  settings.
- Administrators receive aggregate global share metadata only.
- Global administration excludes filenames, descriptions, tokens, previews,
  and file bodies.
- Administrators may suspend users, revoke sessions, set quotas, and revoke a
  public link without gaining access to its contents.
- Controlled branding accepts PNG, JPEG, or WebP, limits input pixels/bytes,
  strips metadata, and re-encodes to WebP. Arbitrary SVG, CSS, HTML, and remote
  URLs are rejected.

## Deployment requirements

1. Generate independent random values for `VEYRA_SECRET` and
   `VEYRA_IP_SALT`; do not commit them.
2. Use HTTPS, set the correct public `VEYRA_BASE_URL`, enable secure cookies,
   and restrict access to the origin port.
3. Back up the full `/data` volume, including SQLite, files, branding, and
   quarantine. Encrypt and access-control backups.
4. Keep Docker, the host, Veyra, ClamAV, the reverse proxy, and the identity
   provider patched.
5. Set quotas and the free-space reserve below the real volume capacity.
6. Use a dedicated S3 principal restricted to the configured bucket/prefix.
7. Verify TLS for SMTP, OIDC, S3, and ClamAV network paths.
8. Monitor quarantine growth and define a retention procedure.
9. Do not run multiple active Veyra replicas against one SQLite database.
10. Configure the reverse proxy to avoid retaining bearer-token paths and OIDC
    callback query parameters in access logs.

## Known boundaries

- Veyra does not provide client-side end-to-end encryption. Server and storage
  administrators can access raw objects through the host or bucket.
- Local object encryption relies on the host filesystem and disk-encryption
  policy; Veyra does not add a separate data-at-rest encryption layer.
- S3 uploads are staged locally to support resume, hashing, and malware
  scanning, so the local free-space reserve still matters.
- SQLite and the local upload-session coordinator make v1.0 a single-node
  application.
- Download counters are enforcement controls, not proof that a recipient did
  not copy a file after download.
- A configured reverse proxy must preserve correct client IP semantics. Enable
  `VEYRA_TRUST_PROXY` only when traffic reaches Veyra exclusively through that
  trusted proxy boundary.
