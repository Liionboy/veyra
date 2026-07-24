# Veyra Roadmap

Veyra is an original implementation informed by the useful product patterns in
[Pingvin Share](https://github.com/stonith404/pingvin-share) and
[Pingvin Share X](https://github.com/smp46/pingvin-share-x).

## Delivered in v1.0

- Atomic per-user and instance quota reservations
- Per-file and per-share limits plus minimum-free-space protection
- Folder selection and recursive drag-and-drop
- Resumable offset-checked uploads with percentage, speed, and ETA
- QR codes, safe previews, direct links, Range requests, and streamed ZIP
  downloads
- Reverse upload requests and a private owner-only submission inbox
- Controlled public branding with raster re-encoding
- Hash-indexed, encrypted, expiring, revocable invitation links
- Aggregate-only global administration and explicit public-link revocation
- Fail-closed ClamAV INSTREAM scanning and quarantine
- OIDC Authorization Code + PKCE with explicit account linking
- Local and S3-compatible object storage
- Local accounts, mandatory verification, TOTP, recovery codes, and password
  recovery
- Six controlled responsive themes

## Next

### Operational resilience

- versioned migration files with dry-run and rollback tooling
- durable delete/tombstone outbox for transient S3 failures
- administrator quarantine retention and purge controls
- background reconciliation for staged, quarantined, and remote objects
- documented online backup and restore verification command
- user-visible upload/session management

### Sharing experience

- multiple email recipients and optional creator Reply-To
- search, sorting, pagination, and bulk revocation
- paste text as a generated file
- optional download notification
- localized interface, beginning with Romanian
- mobile share-sheet and installable PWA

### Identity and security

- WebAuthn passkeys
- user-visible session inventory and remote sign-out
- OIDC provider groups-to-role policy with safe allowlists
- optional audit viewer with retention controls
- signed webhooks, API keys, and ntfy integration

### Larger deployments

- PostgreSQL metadata backend
- external job queue
- direct-to-S3 resumable mode with short-lived authorization and server-side
  verification
- multiple application replicas after metadata and upload coordination move
  away from local SQLite

## Deliberately rejected

Veyra will not adopt:

- arbitrary administrator-injected CSS or HTML;
- passwords sent by email;
- anonymous uploads without quotas and use limits;
- administrator content access disguised as “global management”;
- antivirus that publishes before scanning or fails open;
- OIDC account linking by email alone;
- disabled TLS verification;
- S3 keys derived from user filenames;
- resumable state kept only in process memory;
- long-lived pre-signed URLs that bypass password, expiry, counters, and audit.
