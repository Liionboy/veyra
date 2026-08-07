# Veyra

**Private file sharing, beautifully self-hosted.**

Veyra is a modern, security-focused file-sharing platform for a single
self-hosted server. The web interface and API are packaged together in one
non-root container.

## Highlights

- Resumable uploads for files and complete folders
- Passwords, expiry dates, recipient delivery, and download limits
- Private reverse-upload links for receiving files
- Local or S3-compatible object storage
- Local accounts, TOTP two-factor authentication, invitations, and OIDC
- User, share, and instance storage quotas
- Optional fail-closed ClamAV quarantine
- Optional SMTP delivery and controlled branding
- Streamed ZIP downloads, safe previews, direct links, and QR codes

## Quick start

Requirements: Docker Engine, Docker Compose v2, and OpenSSL.

```bash
mkdir veyra
cd veyra

curl -fsSLO https://raw.githubusercontent.com/Liionboy/veyra/main/docker-compose.hub.yml
curl -fsSL https://raw.githubusercontent.com/Liionboy/veyra/main/.env.example -o .env

mkdir -p .secrets
chmod 700 .secrets
openssl rand -base64 -out .secrets/veyra_secret 48
openssl rand -base64 -out .secrets/veyra_ip_salt 32
chmod 644 .secrets/veyra_secret .secrets/veyra_ip_salt

docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
```

The secret directory is private (`0700`). The files are `0644` so the non-root
container can read file-backed Docker Compose secrets regardless of the host
user ID; Docker mounts them read-only inside the container.

Open [http://localhost:8080](http://localhost:8080) and create the first
administrator account.

Do not regenerate `.secrets/veyra_secret` when updating Veyra. It protects
stored TOTP data, integration credentials, and recoverable links. Back up both
the `veyra-data` volume and the `.secrets` directory.

Useful commands:

```bash
docker compose -f docker-compose.hub.yml ps
docker compose -f docker-compose.hub.yml logs -f veyra
docker compose -f docker-compose.hub.yml restart
```

## Production deployment

Terminate TLS at a trusted reverse proxy and update `.env`:

```env
VEYRA_BASE_URL=https://share.example.com
VEYRA_SECURE_COOKIES=true
VEYRA_TRUST_PROXY=true
```

Only enable `VEYRA_TRUST_PROXY` when all traffic reaches Veyra through that
trusted proxy. Do not expose port `8080` directly to the Internet.

For large and resumable uploads, configure an Nginx-compatible proxy with:

```nginx
client_max_body_size 0;
proxy_request_buffering off;
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
send_timeout 3600s;
```

## Data and updates

Application data is stored in the `veyra-data` Docker volume. Back it up before
upgrading. Never run `docker compose down -v` unless you intentionally want to
delete all Veyra data.

This deployment is deliberately single-node: do not run multiple active
replicas against the same SQLite database.

Version `1.1.1`:

```yaml
image: adrianbrisca/veyra:1.1.1
```

Use a versioned tag for predictable deployments. `latest` follows the newest
stable release.

## Security notes

- Runs as the unprivileged `node` user
- Read-only root filesystem
- All Linux capabilities dropped
- `no-new-privileges` enabled
- Persistent writes restricted to `/data`
- High-entropy secrets supplied as mounted files
- Built-in health check
- Strict browser security headers and scoped `HttpOnly` cookies

Veyra does not provide client-side end-to-end encryption. The server or storage
administrator can access stored objects.

See the complete
[security model](https://github.com/Liionboy/veyra/blob/main/SECURITY.md).

## Links

- [GitHub repository](https://github.com/Liionboy/veyra)
- [Documentation](https://github.com/Liionboy/veyra#readme)
- [Issues](https://github.com/Liionboy/veyra/issues)
- [Releases](https://github.com/Liionboy/veyra/releases)

Licensed under the
[MIT License](https://github.com/Liionboy/veyra/blob/main/LICENSE).
