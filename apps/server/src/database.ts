import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface ShareRecord {
  id: string;
  token_hash: string;
  token_encrypted: string | null;
  owner_id: string | null;
  created_at: number;
  expires_at: number | null;
  max_downloads: number | null;
  download_count: number;
  password_hash: string | null;
  password_salt: string | null;
  note: string | null;
  title: string | null;
  description: string | null;
  recipient_email: string | null;
  status: "uploading" | "processing" | "ready" | "quarantined" | "failed";
  source: "outbound" | "reverse";
  reverse_share_id: string | null;
  sender_name: string | null;
  sender_email: string | null;
  total_size: number;
}

export interface FileRecord {
  id: string;
  share_id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size: number;
  sha256: string;
  relative_path: string;
  storage_provider: "local" | "s3" | "quarantine";
  scan_status: "clean" | "disabled" | "infected" | "error";
  quarantine_reason: string | null;
}

export interface NewShare {
  share: ShareRecord;
  files: FileRecord[];
}

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  totp_secret: string | null;
  totp_enabled: number;
  role: "admin" | "member";
  email_verified_at: number | null;
  disabled_at: number | null;
  quota_bytes: number | null;
  created_at: number;
}

export interface ManagedUserRecord {
  id: string;
  email: string;
  role: "admin" | "member";
  email_verified_at: number | null;
  disabled_at: number | null;
  totp_enabled: number;
  created_at: number;
  share_count: number;
  total_size: number;
  quota_bytes: number | null;
}

export interface SessionRecord {
  token_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface ManagedShareRecord extends ShareRecord {
  file_count: number;
}

export interface CapacityPolicy {
  maxShareBytes: number;
  defaultUserQuotaBytes: number | null;
  instanceQuotaBytes: number | null;
  minimumFreeBytes: number;
  maxFilesPerShare: number;
}

export interface CapacityUsage {
  committedBytes: number;
  reservedBytes: number;
  totalBytes: number;
}

export interface UploadFileRecord {
  id: string;
  upload_id: string;
  position: number;
  original_name: string;
  relative_path: string;
  mime_type: string;
  expected_size: number;
  received_size: number;
  temp_name: string;
  created_at: number;
  updated_at: number;
}

export interface UploadSessionRecord {
  id: string;
  owner_id: string;
  share_id: string | null;
  submission_id: string | null;
  reverse_share_id: string | null;
  secret_hash: string | null;
  status: "uploading" | "processing" | "completed" | "quarantined" | "failed";
  storage_provider: "local" | "s3" | null;
  expected_size: number;
  received_size: number;
  file_count: number;
  options_json: string;
  error: string | null;
  effects_claimed_at: number | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export interface NewUploadSession {
  session: UploadSessionRecord;
  share?: ShareRecord;
  submission?: ReverseSubmissionRecord;
  files: UploadFileRecord[];
}

export interface ReverseShareRecord {
  id: string;
  owner_id: string;
  token_hash: string;
  token_encrypted: string;
  title: string;
  description: string | null;
  password_hash: string | null;
  password_salt: string | null;
  expires_at: number | null;
  max_files: number;
  max_total_size: number;
  max_submissions: number;
  submission_count: number;
  enabled: number;
  created_at: number;
}

export interface ReverseSubmissionRecord {
  id: string;
  reverse_share_id: string;
  owner_id: string;
  sender_name: string | null;
  sender_email: string | null;
  message: string | null;
  status: "uploading" | "processing" | "ready" | "quarantined" | "failed";
  total_size: number;
  file_count: number;
  created_at: number;
}

export interface SubmissionFileRecord {
  id: string;
  submission_id: string;
  original_name: string;
  relative_path: string;
  stored_name: string;
  storage_provider: "local" | "s3" | "quarantine";
  mime_type: string;
  size: number;
  sha256: string;
  scan_status: "clean" | "disabled" | "infected" | "error";
  quarantine_reason: string | null;
}

export interface InvitationRecord {
  id: string;
  token_hash: string;
  token_encrypted: string;
  email: string | null;
  created_by: string;
  expires_at: number;
  max_uses: number;
  use_count: number;
  revoked_at: number | null;
  created_at: number;
}

export interface OidcIdentityRecord {
  issuer: string;
  subject: string;
  user_id: string;
  email: string;
  created_at: number;
}

export interface GlobalShareRecord {
  id: string;
  owner_id: string | null;
  owner_email: string | null;
  status: ShareRecord["status"];
  source: ShareRecord["source"];
  created_at: number;
  expires_at: number | null;
  file_count: number;
  total_size: number;
}

export interface StoredObjectReference {
  stored_name: string;
  storage_provider: FileRecord["storage_provider"];
}

export interface ObjectDeletionRecord extends StoredObjectReference {
  attempts: number;
  last_error: string | null;
  next_attempt_at: number;
}

export class VeyraDatabase {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shares (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        max_downloads INTEGER,
        download_count INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT,
        password_salt TEXT,
        note TEXT,
        owner_id TEXT,
        token_encrypted TEXT,
        title TEXT,
        description TEXT,
        recipient_email TEXT,
        status TEXT NOT NULL DEFAULT 'ready',
        source TEXT NOT NULL DEFAULT 'outbound',
        reverse_share_id TEXT,
        sender_name TEXT,
        sender_email TEXT,
        total_size INTEGER NOT NULL DEFAULT 0,
        CHECK (max_downloads IS NULL OR max_downloads > 0)
      );

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        relative_path TEXT NOT NULL DEFAULT '',
        storage_provider TEXT NOT NULL DEFAULT 'local',
        scan_status TEXT NOT NULL DEFAULT 'clean',
        quarantine_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        share_id TEXT,
        event TEXT NOT NULL,
        ip_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        details TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares(expires_at);
      CREATE INDEX IF NOT EXISTS idx_files_share_id ON files(share_id);
      CREATE INDEX IF NOT EXISTS idx_audit_share_id ON audit_events(share_id);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL DEFAULT 'member',
        email_verified_at INTEGER,
        disabled_at INTEGER,
        quota_bytes INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recovery_codes (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        used_at INTEGER,
        PRIMARY KEY (user_id, code_hash)
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS email_delivery_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        share_id TEXT,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        audit_event_id INTEGER UNIQUE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS upload_sessions (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        share_id TEXT UNIQUE REFERENCES shares(id) ON DELETE CASCADE,
        submission_id TEXT UNIQUE REFERENCES reverse_submissions(id) ON DELETE CASCADE,
        reverse_share_id TEXT,
        secret_hash TEXT,
        status TEXT NOT NULL,
        storage_provider TEXT,
        expected_size INTEGER NOT NULL,
        received_size INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER NOT NULL,
        options_json TEXT NOT NULL,
        error TEXT,
        effects_claimed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS upload_files (
        id TEXT PRIMARY KEY,
        upload_id TEXT NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        original_name TEXT NOT NULL,
        relative_path TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL,
        expected_size INTEGER NOT NULL,
        received_size INTEGER NOT NULL DEFAULT 0,
        temp_name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reverse_shares (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        token_encrypted TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        password_hash TEXT,
        password_salt TEXT,
        expires_at INTEGER,
        max_files INTEGER NOT NULL,
        max_total_size INTEGER NOT NULL,
        max_submissions INTEGER NOT NULL DEFAULT 100,
        submission_count INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reverse_submissions (
        id TEXT PRIMARY KEY,
        reverse_share_id TEXT NOT NULL REFERENCES reverse_shares(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_name TEXT,
        sender_email TEXT,
        message TEXT,
        status TEXT NOT NULL,
        total_size INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS submission_files (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES reverse_submissions(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        relative_path TEXT NOT NULL DEFAULT '',
        stored_name TEXT NOT NULL UNIQUE,
        storage_provider TEXT NOT NULL DEFAULT 'local',
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        scan_status TEXT NOT NULL DEFAULT 'clean',
        quarantine_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        token_encrypted TEXT NOT NULL,
        email TEXT,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        max_uses INTEGER NOT NULL DEFAULT 1,
        use_count INTEGER NOT NULL DEFAULT 0,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oidc_identities (
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (issuer, subject),
        UNIQUE (user_id, issuer)
      );

      CREATE TABLE IF NOT EXISTS oidc_states (
        state_hash TEXT PRIMARY KEY,
        code_verifier_encrypted TEXT NOT NULL,
        nonce TEXT NOT NULL,
        user_id TEXT,
        mode TEXT NOT NULL DEFAULT 'login',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS object_deletions (
        stored_name TEXT NOT NULL,
        storage_provider TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (storage_provider, stored_name)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_reset_expires_at ON password_reset_tokens(expires_at);
      CREATE INDEX IF NOT EXISTS idx_verification_expires_at
      ON email_verification_tokens(expires_at);
      CREATE INDEX IF NOT EXISTS idx_email_delivery_user_created
      ON email_delivery_events(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_upload_sessions_owner_status
      ON upload_sessions(owner_id, status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_upload_files_upload
      ON upload_files(upload_id);
      CREATE INDEX IF NOT EXISTS idx_reverse_shares_owner_created
      ON reverse_shares(owner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reverse_submissions_owner_created
      ON reverse_submissions(owner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_submission_files_submission
      ON submission_files(submission_id);
      CREATE INDEX IF NOT EXISTS idx_invitations_created
      ON invitations(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_oidc_states_expires
      ON oidc_states(expires_at);
      CREATE INDEX IF NOT EXISTS idx_object_deletions_retry
      ON object_deletions(next_attempt_at, attempts);
    `);

    const userColumns = new Set(
      (
        this.db.prepare("PRAGMA table_info(users)").all() as unknown as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    if (!userColumns.has("role")) {
      this.db.exec(
        "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'",
      );
    }
    const addedEmailVerification = !userColumns.has("email_verified_at");
    if (addedEmailVerification) {
      this.db.exec("ALTER TABLE users ADD COLUMN email_verified_at INTEGER");
    }

    const uploadFileColumns = new Set(
      (
        this.db
          .prepare("PRAGMA table_info(upload_files)")
          .all() as unknown as Array<{ name: string }>
      ).map((column) => column.name),
    );
    if (!uploadFileColumns.has("position")) {
      this.db.exec(
        "ALTER TABLE upload_files ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
      );
      this.db.exec(`
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY upload_id ORDER BY created_at, id
                 ) - 1 AS calculated_position
          FROM upload_files
        )
        UPDATE upload_files
        SET position = (
          SELECT calculated_position FROM ranked WHERE ranked.id = upload_files.id
        );
      `);
    }

    const uploadSessionColumns = new Set(
      (
        this.db
          .prepare("PRAGMA table_info(upload_sessions)")
          .all() as unknown as Array<{ name: string }>
      ).map((column) => column.name),
    );
    if (!uploadSessionColumns.has("storage_provider")) {
      this.db.exec("ALTER TABLE upload_sessions ADD COLUMN storage_provider TEXT");
    }
    if (!uploadSessionColumns.has("effects_claimed_at")) {
      this.db.exec("ALTER TABLE upload_sessions ADD COLUMN effects_claimed_at INTEGER");
    }
    if (!userColumns.has("disabled_at")) {
      this.db.exec("ALTER TABLE users ADD COLUMN disabled_at INTEGER");
    }
    if (!userColumns.has("quota_bytes")) {
      this.db.exec("ALTER TABLE users ADD COLUMN quota_bytes INTEGER");
    }
    if (addedEmailVerification) {
      this.db.exec(
        "UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL",
      );
    }
    this.db.exec(`
      UPDATE users
      SET role = 'admin'
      WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
    `);

    const shareColumns = new Set(
      (
        this.db.prepare("PRAGMA table_info(shares)").all() as unknown as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    if (!shareColumns.has("owner_id")) {
      this.db.exec("ALTER TABLE shares ADD COLUMN owner_id TEXT");
    }
    if (!shareColumns.has("token_encrypted")) {
      this.db.exec("ALTER TABLE shares ADD COLUMN token_encrypted TEXT");
    }
    if (!shareColumns.has("title")) {
      this.db.exec("ALTER TABLE shares ADD COLUMN title TEXT");
    }
    if (!shareColumns.has("description")) {
      this.db.exec("ALTER TABLE shares ADD COLUMN description TEXT");
    }
    if (!shareColumns.has("recipient_email")) {
      this.db.exec("ALTER TABLE shares ADD COLUMN recipient_email TEXT");
    }
    if (!shareColumns.has("status")) {
      this.db.exec(
        "ALTER TABLE shares ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'",
      );
    }
    if (!shareColumns.has("source")) {
      this.db.exec(
        "ALTER TABLE shares ADD COLUMN source TEXT NOT NULL DEFAULT 'outbound'",
      );
    }
    if (!shareColumns.has("reverse_share_id")) {
      this.db.exec("ALTER TABLE shares ADD COLUMN reverse_share_id TEXT");
    }
    if (!shareColumns.has("sender_name")) {
      this.db.exec("ALTER TABLE shares ADD COLUMN sender_name TEXT");
    }
    if (!shareColumns.has("sender_email")) {
      this.db.exec("ALTER TABLE shares ADD COLUMN sender_email TEXT");
    }
    if (!shareColumns.has("total_size")) {
      this.db.exec(
        "ALTER TABLE shares ADD COLUMN total_size INTEGER NOT NULL DEFAULT 0",
      );
    }

    const fileColumns = new Set(
      (
        this.db.prepare("PRAGMA table_info(files)").all() as unknown as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    if (!fileColumns.has("relative_path")) {
      this.db.exec(
        "ALTER TABLE files ADD COLUMN relative_path TEXT NOT NULL DEFAULT ''",
      );
    }
    if (!fileColumns.has("storage_provider")) {
      this.db.exec(
        "ALTER TABLE files ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'local'",
      );
    }
    if (!fileColumns.has("scan_status")) {
      this.db.exec(
        "ALTER TABLE files ADD COLUMN scan_status TEXT NOT NULL DEFAULT 'clean'",
      );
    }
    if (!fileColumns.has("quarantine_reason")) {
      this.db.exec("ALTER TABLE files ADD COLUMN quarantine_reason TEXT");
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_shares_owner_created
      ON shares(owner_id, created_at DESC);

      UPDATE shares
      SET description = note
      WHERE description IS NULL AND note IS NOT NULL;

      UPDATE shares
      SET owner_id = (SELECT id FROM users LIMIT 1)
      WHERE owner_id IS NULL AND (SELECT COUNT(*) FROM users) = 1;

      UPDATE shares
      SET total_size = COALESCE((
        SELECT SUM(files.size) FROM files WHERE files.share_id = shares.id
      ), 0);

      INSERT OR IGNORE INTO email_delivery_events (
        user_id, share_id, kind, created_at, audit_event_id
      )
      SELECT
        shares.owner_id,
        audit_events.share_id,
        'share',
        audit_events.created_at,
        audit_events.id
      FROM audit_events
      JOIN shares ON shares.id = audit_events.share_id
      WHERE audit_events.event = 'share.email_sent'
        AND shares.owner_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (1, unixepoch('now') * 1000);
      INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (2, unixepoch('now') * 1000);
    `);
  }

  createShare(value: NewShare): void {
    const insertShare = this.db.prepare(`
      INSERT INTO shares (
        id, token_hash, created_at, expires_at, max_downloads,
        download_count, password_hash, password_salt, note, owner_id,
        token_encrypted, title, description, recipient_email, status, source,
        reverse_share_id, sender_name, sender_email, total_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFile = this.db.prepare(`
      INSERT INTO files (
        id, share_id, original_name, stored_name, mime_type, size, sha256,
        relative_path, storage_provider, scan_status, quarantine_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const share = value.share;
      insertShare.run(
        share.id,
        share.token_hash,
        share.created_at,
        share.expires_at,
        share.max_downloads,
        share.download_count,
        share.password_hash,
        share.password_salt,
        share.note,
        share.owner_id,
        share.token_encrypted,
        share.title,
        share.description,
        share.recipient_email,
        share.status,
        share.source,
        share.reverse_share_id,
        share.sender_name,
        share.sender_email,
        share.total_size,
      );
      for (const file of value.files) {
        insertFile.run(
          file.id,
          file.share_id,
          file.original_name,
          file.stored_name,
          file.mime_type,
          file.size,
          file.sha256,
          file.relative_path,
          file.storage_provider,
          file.scan_status,
          file.quarantine_reason,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  findShareByToken(token: string): ShareRecord | undefined {
    return this.db
      .prepare(
        `SELECT shares.* FROM shares
         LEFT JOIN users ON users.id = shares.owner_id
         WHERE shares.token_hash = ?
           AND (shares.owner_id IS NULL OR users.disabled_at IS NULL)`,
      )
      .get(token) as ShareRecord | undefined;
  }

  findShareById(id: string): ShareRecord | undefined {
    return this.db
      .prepare("SELECT * FROM shares WHERE id = ?")
      .get(id) as ShareRecord | undefined;
  }

  listFiles(shareId: string): FileRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM files WHERE share_id = ? ORDER BY original_name COLLATE NOCASE`,
      )
      .all(shareId) as unknown as FileRecord[];
  }

  findFile(shareId: string, fileId: string): FileRecord | undefined {
    return this.db
      .prepare("SELECT * FROM files WHERE share_id = ? AND id = ?")
      .get(shareId, fileId) as FileRecord | undefined;
  }

  consumeDownload(shareId: string): boolean {
    const result = this.db
      .prepare(`
        UPDATE shares
        SET download_count = download_count + 1
        WHERE id = ?
          AND (max_downloads IS NULL OR download_count < max_downloads)
      `)
      .run(shareId);
    return result.changes === 1;
  }

  deleteExpired(now = Date.now()): StoredObjectReference[] {
    const files = this.db
      .prepare(
        `SELECT files.stored_name, files.storage_provider
         FROM files
         JOIN shares ON shares.id = files.share_id
         WHERE shares.expires_at IS NOT NULL AND shares.expires_at <= ?`,
      )
      .all(now) as unknown as StoredObjectReference[];

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.insertObjectDeletions(files);
      this.db
        .prepare(
          "DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at <= ?",
        )
        .run(now);
      this.db.exec("COMMIT");
      return files;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listManagedShares(userId: string): ManagedShareRecord[] {
    return this.db
      .prepare(
        `SELECT shares.*,
           COUNT(files.id) AS file_count
         FROM shares
         LEFT JOIN files ON files.share_id = shares.id
         WHERE shares.owner_id = ?
         GROUP BY shares.id
         ORDER BY shares.created_at DESC`,
      )
      .all(userId) as unknown as ManagedShareRecord[];
  }

  findManagedShare(userId: string, shareId: string): ShareRecord | undefined {
    return this.db
      .prepare("SELECT * FROM shares WHERE id = ? AND owner_id = ?")
      .get(shareId, userId) as ShareRecord | undefined;
  }

  rotateManagedShareToken(
    userId: string,
    shareId: string,
    tokenHash: string,
    encryptedToken: string,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE shares SET token_hash = ?, token_encrypted = ?
         WHERE id = ? AND owner_id = ?`,
      )
      .run(tokenHash, encryptedToken, shareId, userId);
    return result.changes === 1;
  }

  updateManagedShare(
    userId: string,
    shareId: string,
    values: {
      expiresAt: number | null;
      maxDownloads: number | null;
      title: string | null;
      description: string | null;
      recipientEmail: string | null;
      passwordHash?: string | null;
      passwordSalt?: string | null;
    },
  ): boolean {
    const updatePassword = values.passwordHash !== undefined;
    const result = this.db
      .prepare(
        `UPDATE shares
         SET expires_at = ?, max_downloads = ?, title = ?, description = ?,
             recipient_email = ?,
             password_hash = CASE WHEN ? THEN ? ELSE password_hash END,
             password_salt = CASE WHEN ? THEN ? ELSE password_salt END
         WHERE id = ? AND owner_id = ?`,
      )
      .run(
        values.expiresAt,
        values.maxDownloads,
        values.title,
        values.description,
        values.recipientEmail,
        updatePassword ? 1 : 0,
        values.passwordHash ?? null,
        updatePassword ? 1 : 0,
        values.passwordSalt ?? null,
        shareId,
        userId,
      );
    return result.changes === 1;
  }

  deleteManagedShare(
    userId: string,
    shareId: string,
  ): StoredObjectReference[] | undefined {
    const existing = this.findManagedShare(userId, shareId);
    if (!existing) return undefined;
    const files = this.db
      .prepare(
        "SELECT stored_name, storage_provider FROM files WHERE share_id = ?",
      )
      .all(shareId) as unknown as StoredObjectReference[];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.insertObjectDeletions(files);
      this.db.prepare("DELETE FROM shares WHERE id = ? AND owner_id = ?").run(
        shareId,
        userId,
      );
      this.db.exec("COMMIT");
      return files;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  capacityUsage(userId?: string, now = Date.now()): CapacityUsage {
    const ownerClause = userId ? "WHERE owner_id = ?" : "";
    const committed = this.db
      .prepare(
        `SELECT COALESCE(SUM(size), 0) AS bytes FROM (
           SELECT files.size AS size, shares.owner_id AS owner_id
           FROM files
           JOIN shares ON shares.id = files.share_id
           UNION ALL
           SELECT submission_files.size AS size,
                  reverse_submissions.owner_id AS owner_id
           FROM submission_files
           JOIN reverse_submissions
             ON reverse_submissions.id = submission_files.submission_id
         ) ${ownerClause}`,
      )
      .get(...(userId ? [userId] : [])) as { bytes: number };
    const reserved = this.db
      .prepare(
        `SELECT COALESCE(SUM(expected_size), 0) AS bytes
         FROM upload_sessions
         WHERE status IN ('uploading', 'processing')
           AND expires_at > ?
           ${userId ? "AND owner_id = ?" : ""}`,
      )
      .get(...(userId ? [now, userId] : [now])) as { bytes: number };
    return {
      committedBytes: Number(committed.bytes),
      reservedBytes: Number(reserved.bytes),
      totalBytes: Number(committed.bytes) + Number(reserved.bytes),
    };
  }

  storedObjectCount(provider: "local" | "s3" | "quarantine"): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
           SELECT stored_name FROM files WHERE storage_provider = ?
           UNION ALL
           SELECT stored_name FROM submission_files WHERE storage_provider = ?
           UNION ALL
           SELECT stored_name FROM object_deletions WHERE storage_provider = ?
         )`,
      )
      .get(provider, provider, provider) as { count: number };
    return Number(row.count);
  }

  private insertObjectDeletions(objects: StoredObjectReference[]): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO object_deletions (
        stored_name, storage_provider, attempts, last_error,
        next_attempt_at, created_at
      ) VALUES (?, ?, 0, NULL, 0, ?)`,
    );
    const now = Date.now();
    for (const object of objects) {
      insert.run(object.stored_name, object.storage_provider, now);
    }
  }

  queueObjectDeletions(objects: StoredObjectReference[]): void {
    if (objects.length === 0) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.insertObjectDeletions(objects);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listPendingObjectDeletions(
    limit = 100,
    now = Date.now(),
  ): ObjectDeletionRecord[] {
    return this.db
      .prepare(
        `SELECT stored_name, storage_provider, attempts, last_error,
                next_attempt_at
         FROM object_deletions
         WHERE next_attempt_at <= ?
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(now, limit) as unknown as ObjectDeletionRecord[];
  }

  completeObjectDeletion(
    provider: StoredObjectReference["storage_provider"],
    storedName: string,
  ): void {
    this.db
      .prepare(
        `DELETE FROM object_deletions
         WHERE storage_provider = ? AND stored_name = ?`,
      )
      .run(provider, storedName);
  }

  failObjectDeletion(
    provider: StoredObjectReference["storage_provider"],
    storedName: string,
    message: string,
  ): void {
    const existing = this.db
      .prepare(
        `SELECT attempts FROM object_deletions
         WHERE storage_provider = ? AND stored_name = ?`,
      )
      .get(provider, storedName) as { attempts: number } | undefined;
    if (!existing) return;
    const attempts = existing.attempts + 1;
    const delay = Math.min(24 * 60 * 60 * 1_000, 2 ** Math.min(attempts, 12) * 1_000);
    this.db
      .prepare(
        `UPDATE object_deletions
         SET attempts = ?, last_error = ?, next_attempt_at = ?
         WHERE storage_provider = ? AND stored_name = ?`,
      )
      .run(
        attempts,
        message.slice(0, 500),
        Date.now() + delay,
        provider,
        storedName,
      );
  }

  userQuota(userId: string): number | null {
    const row = this.db
      .prepare("SELECT quota_bytes FROM users WHERE id = ?")
      .get(userId) as { quota_bytes: number | null } | undefined;
    return row?.quota_bytes ?? null;
  }

  setUserQuota(userId: string, quotaBytes: number | null): boolean {
    const result = this.db
      .prepare(
        "UPDATE users SET quota_bytes = ? WHERE id = ? AND role != 'admin'",
      )
      .run(quotaBytes, userId);
    return result.changes === 1;
  }

  createUploadSession(
    value: NewUploadSession,
    policy: CapacityPolicy,
  ): void {
    const session = value.session;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const userUsage = this.capacityUsage(session.owner_id);
      const instanceUsage = this.capacityUsage();
      const owner = this.findUserById(session.owner_id);
      if (!owner) throw Object.assign(new Error("Upload owner not found."), { statusCode: 404 });
      const userQuota = owner.quota_bytes ?? policy.defaultUserQuotaBytes;
      if (
        userQuota !== null &&
        userUsage.totalBytes + session.expected_size > userQuota
      ) {
        throw Object.assign(new Error("This upload exceeds the user's storage quota."), {
          statusCode: 413,
          code: "USER_QUOTA_EXCEEDED",
        });
      }
      if (
        policy.instanceQuotaBytes !== null &&
        instanceUsage.totalBytes + session.expected_size >
          policy.instanceQuotaBytes
      ) {
        throw Object.assign(new Error("This instance has reached its storage quota."), {
          statusCode: 507,
          code: "INSTANCE_QUOTA_EXCEEDED",
        });
      }

      if (value.share) {
        const share = value.share;
        this.db
          .prepare(
            `INSERT INTO shares (
              id, token_hash, created_at, expires_at, max_downloads,
              download_count, password_hash, password_salt, note, owner_id,
              token_encrypted, title, description, recipient_email, status,
              source, reverse_share_id, sender_name, sender_email, total_size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            share.id,
            share.token_hash,
            share.created_at,
            share.expires_at,
            share.max_downloads,
            share.download_count,
            share.password_hash,
            share.password_salt,
            share.note,
            share.owner_id,
            share.token_encrypted,
            share.title,
            share.description,
            share.recipient_email,
            share.status,
            share.source,
            share.reverse_share_id,
            share.sender_name,
            share.sender_email,
            share.total_size,
          );
      } else if (value.submission) {
        const submission = value.submission;
        const request = this.db
          .prepare(
            `SELECT submission_count, max_submissions, enabled, expires_at
             FROM reverse_shares WHERE id = ?`,
          )
          .get(submission.reverse_share_id) as
          | {
              submission_count: number;
              max_submissions: number;
              enabled: number;
              expires_at: number | null;
            }
          | undefined;
        const activeReservations = this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM upload_sessions
             WHERE reverse_share_id = ?
               AND status IN ('uploading', 'processing')
               AND expires_at > ?`,
          )
          .get(submission.reverse_share_id, Date.now()) as { count: number };
        if (
          !request ||
          request.enabled !== 1 ||
          (request.expires_at !== null && request.expires_at <= Date.now())
        ) {
          throw Object.assign(new Error("This upload request is no longer available."), {
            statusCode: 404,
          });
        }
        if (
          request.submission_count + Number(activeReservations.count) >=
          request.max_submissions
        ) {
          throw Object.assign(new Error("This upload request reached its submission limit."), {
            statusCode: 410,
          });
        }
        this.db
          .prepare(
            `INSERT INTO reverse_submissions (
              id, reverse_share_id, owner_id, sender_name, sender_email,
              message, status, total_size, file_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            submission.id,
            submission.reverse_share_id,
            submission.owner_id,
            submission.sender_name,
            submission.sender_email,
            submission.message,
            submission.status,
            submission.total_size,
            submission.file_count,
            submission.created_at,
          );
      } else {
        throw new Error("An upload session needs a share or submission target.");
      }

      this.db
        .prepare(
          `INSERT INTO upload_sessions (
            id, owner_id, share_id, submission_id, reverse_share_id,
            secret_hash, status, storage_provider, expected_size, received_size,
            file_count, options_json, error, effects_claimed_at, created_at,
            updated_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          session.id,
          session.owner_id,
          session.share_id,
          session.submission_id,
          session.reverse_share_id,
          session.secret_hash,
          session.status,
          session.storage_provider,
          session.expected_size,
          session.received_size,
          session.file_count,
          session.options_json,
          session.error,
          session.effects_claimed_at,
          session.created_at,
          session.updated_at,
          session.expires_at,
        );
      const insertFile = this.db.prepare(
        `INSERT INTO upload_files (
          id, upload_id, position, original_name, relative_path, mime_type,
          expected_size, received_size, temp_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const file of value.files) {
        insertFile.run(
          file.id,
          file.upload_id,
          file.position,
          file.original_name,
          file.relative_path,
          file.mime_type,
          file.expected_size,
          file.received_size,
          file.temp_name,
          file.created_at,
          file.updated_at,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  findUploadSession(uploadId: string): UploadSessionRecord | undefined {
    return this.db
      .prepare("SELECT * FROM upload_sessions WHERE id = ?")
      .get(uploadId) as UploadSessionRecord | undefined;
  }

  findUploadSessionForUser(
    uploadId: string,
    userId: string,
  ): UploadSessionRecord | undefined {
    return this.db
      .prepare("SELECT * FROM upload_sessions WHERE id = ? AND owner_id = ?")
      .get(uploadId, userId) as UploadSessionRecord | undefined;
  }

  findUploadSessionBySecret(
    uploadId: string,
    secretHash: string,
  ): UploadSessionRecord | undefined {
    return this.db
      .prepare(
        "SELECT * FROM upload_sessions WHERE id = ? AND secret_hash = ?",
      )
      .get(uploadId, secretHash) as UploadSessionRecord | undefined;
  }

  listUploadFiles(uploadId: string): UploadFileRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM upload_files WHERE upload_id = ? ORDER BY position, id",
      )
      .all(uploadId) as unknown as UploadFileRecord[];
  }

  findUploadFile(
    uploadId: string,
    fileId: string,
  ): UploadFileRecord | undefined {
    return this.db
      .prepare(
        "SELECT * FROM upload_files WHERE upload_id = ? AND id = ?",
      )
      .get(uploadId, fileId) as UploadFileRecord | undefined;
  }

  advanceUploadFile(
    uploadId: string,
    fileId: string,
    expectedOffset: number,
    receivedBytes: number,
  ): number | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const updatedAt = Date.now();
      const result = this.db
        .prepare(
          `UPDATE upload_files
           SET received_size = received_size + ?, updated_at = ?
           WHERE upload_id = ? AND id = ? AND received_size = ?
             AND received_size + ? <= expected_size`,
        )
        .run(
          receivedBytes,
          updatedAt,
          uploadId,
          fileId,
          expectedOffset,
          receivedBytes,
        );
      if (result.changes !== 1) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      this.db
        .prepare(
          `UPDATE upload_sessions
           SET received_size = received_size + ?, updated_at = ?
           WHERE id = ? AND status = 'uploading'`,
        )
        .run(receivedBytes, updatedAt, uploadId);
      this.db.exec("COMMIT");
      return expectedOffset + receivedBytes;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  reconcileUploadFileSize(
    uploadId: string,
    fileId: string,
    actualSize: number,
  ): number | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const file = this.findUploadFile(uploadId, fileId);
      if (
        !file ||
        !Number.isSafeInteger(actualSize) ||
        actualSize < 0 ||
        actualSize > file.expected_size
      ) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      const delta = actualSize - file.received_size;
      if (delta !== 0) {
        this.db
          .prepare(
            `UPDATE upload_files
             SET received_size = ?, updated_at = ?
             WHERE upload_id = ? AND id = ?`,
          )
          .run(actualSize, Date.now(), uploadId, fileId);
        this.db
          .prepare(
            `UPDATE upload_sessions
             SET received_size = received_size + ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(delta, Date.now(), uploadId);
      }
      this.db.exec("COMMIT");
      return actualSize;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markUploadProcessing(
    uploadId: string,
    storageProvider: "local" | "s3",
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE upload_sessions
         SET status = 'processing',
             storage_provider = COALESCE(storage_provider, ?),
             updated_at = ?
         WHERE id = ? AND status IN ('uploading', 'failed', 'processing')
           AND received_size = expected_size`,
      )
      .run(storageProvider, Date.now(), uploadId);
    if (result.changes === 1) {
      this.db
        .prepare(
          `UPDATE shares SET status = 'processing'
           WHERE id = (SELECT share_id FROM upload_sessions WHERE id = ?)`,
        )
        .run(uploadId);
      this.db
        .prepare(
          `UPDATE reverse_submissions SET status = 'processing'
           WHERE id = (SELECT submission_id FROM upload_sessions WHERE id = ?)`,
        )
        .run(uploadId);
    }
    return result.changes === 1;
  }

  claimUploadCompletionEffects(uploadId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE upload_sessions SET effects_claimed_at = ?
         WHERE id = ? AND status = 'completed' AND effects_claimed_at IS NULL`,
      )
      .run(Date.now(), uploadId);
    return result.changes === 1;
  }

  completeUpload(
    uploadId: string,
    files: Array<FileRecord | SubmissionFileRecord>,
  ): void {
    const session = this.findUploadSession(uploadId);
    if (!session) throw new Error("Upload session not found.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (session.share_id) {
        const insert = this.db.prepare(
          `INSERT INTO files (
            id, share_id, original_name, stored_name, mime_type, size, sha256,
            relative_path, storage_provider, scan_status, quarantine_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const generic of files) {
          const file = generic as FileRecord;
          insert.run(
            file.id,
            session.share_id,
            file.original_name,
            file.stored_name,
            file.mime_type,
            file.size,
            file.sha256,
            file.relative_path,
            file.storage_provider,
            file.scan_status,
            file.quarantine_reason,
          );
        }
        this.db
          .prepare(
            `UPDATE shares SET status = 'ready', total_size = ?
             WHERE id = ?`,
          )
          .run(session.expected_size, session.share_id);
      } else if (session.submission_id) {
        const insert = this.db.prepare(
          `INSERT INTO submission_files (
            id, submission_id, original_name, relative_path, stored_name,
            storage_provider, mime_type, size, sha256, scan_status,
            quarantine_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const generic of files) {
          const file = generic as SubmissionFileRecord;
          insert.run(
            file.id,
            session.submission_id,
            file.original_name,
            file.relative_path,
            file.stored_name,
            file.storage_provider,
            file.mime_type,
            file.size,
            file.sha256,
            file.scan_status,
            file.quarantine_reason,
          );
        }
        this.db
          .prepare(
            `UPDATE reverse_submissions
             SET status = 'ready', total_size = ?
             WHERE id = ?`,
          )
          .run(session.expected_size, session.submission_id);
        this.db
          .prepare(
            `UPDATE reverse_shares
             SET submission_count = submission_count + 1
             WHERE id = ?`,
          )
          .run(session.reverse_share_id);
      }
      this.db
        .prepare(
          `UPDATE upload_sessions
           SET status = 'completed', updated_at = ?, error = NULL WHERE id = ?`,
        )
        .run(Date.now(), uploadId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  quarantineUpload(
    uploadId: string,
    files: Array<FileRecord | SubmissionFileRecord>,
    reason: string,
  ): void {
    const session = this.findUploadSession(uploadId);
    if (!session) throw new Error("Upload session not found.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (session.share_id) {
        const insert = this.db.prepare(
          `INSERT INTO files (
            id, share_id, original_name, stored_name, mime_type, size, sha256,
            relative_path, storage_provider, scan_status, quarantine_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const generic of files) {
          const file = generic as FileRecord;
          insert.run(
            file.id,
            session.share_id,
            file.original_name,
            file.stored_name,
            file.mime_type,
            file.size,
            file.sha256,
            file.relative_path,
            "quarantine",
            file.scan_status,
            file.quarantine_reason,
          );
        }
        this.db
          .prepare(
            "UPDATE shares SET status = 'quarantined', total_size = ? WHERE id = ?",
          )
          .run(
            files.reduce((total, file) => total + file.size, 0),
            session.share_id,
          );
      } else if (session.submission_id) {
        const insert = this.db.prepare(
          `INSERT INTO submission_files (
            id, submission_id, original_name, relative_path, stored_name,
            storage_provider, mime_type, size, sha256, scan_status,
            quarantine_reason
          ) VALUES (?, ?, ?, ?, ?, 'quarantine', ?, ?, ?, ?, ?)`,
        );
        for (const generic of files) {
          const file = generic as SubmissionFileRecord;
          insert.run(
            file.id,
            session.submission_id,
            file.original_name,
            file.relative_path,
            file.stored_name,
            file.mime_type,
            file.size,
            file.sha256,
            file.scan_status,
            file.quarantine_reason,
          );
        }
        this.db
          .prepare(
            `UPDATE reverse_submissions
             SET status = 'quarantined', total_size = ? WHERE id = ?`,
          )
          .run(
            files.reduce((total, file) => total + file.size, 0),
            session.submission_id,
          );
      }
      this.db
        .prepare(
          `UPDATE upload_sessions
           SET status = 'quarantined', error = ?, updated_at = ? WHERE id = ?`,
        )
        .run(reason.slice(0, 500), Date.now(), uploadId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  failUpload(uploadId: string, reason: string): void {
    const session = this.findUploadSession(uploadId);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `UPDATE upload_sessions
           SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
        )
        .run(reason.slice(0, 500), Date.now(), uploadId);
      if (session?.share_id) {
        this.db
          .prepare("UPDATE shares SET status = 'failed' WHERE id = ?")
          .run(session.share_id);
      }
      if (session?.submission_id) {
        this.db
          .prepare(
            "UPDATE reverse_submissions SET status = 'failed' WHERE id = ?",
          )
          .run(session.submission_id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  cancelUpload(uploadId: string, ownerId?: string): string[] | undefined {
    const session = ownerId
      ? this.findUploadSessionForUser(uploadId, ownerId)
      : this.findUploadSession(uploadId);
    if (!session || !["uploading", "failed"].includes(session.status)) {
      return undefined;
    }
    const tempNames = this.listUploadFiles(uploadId).map((file) => file.temp_name);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (session.share_id) {
        this.db.prepare("DELETE FROM shares WHERE id = ?").run(session.share_id);
      } else if (session.submission_id) {
        this.db
          .prepare("DELETE FROM reverse_submissions WHERE id = ?")
          .run(session.submission_id);
      }
      this.db.prepare("DELETE FROM upload_sessions WHERE id = ?").run(uploadId);
      this.db.exec("COMMIT");
      return tempNames;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  purgeExpiredUploads(now = Date.now()): string[] {
    const rows = this.db
      .prepare(
        `SELECT upload_sessions.id, upload_sessions.share_id,
                upload_sessions.submission_id, upload_sessions.status,
                upload_sessions.storage_provider, upload_files.id AS file_id,
                upload_files.temp_name
         FROM upload_sessions
         LEFT JOIN upload_files ON upload_files.upload_id = upload_sessions.id
         WHERE upload_sessions.expires_at <= ?`,
      )
      .all(now) as unknown as Array<{
      id: string;
      share_id: string | null;
      submission_id: string | null;
      status: UploadSessionRecord["status"];
      storage_provider: "local" | "s3" | null;
      file_id: string | null;
      temp_name: string | null;
    }>;
    const sessions = new Map<
      string,
      {
        shareId: string | null;
        submissionId: string | null;
        status: UploadSessionRecord["status"];
        storageProvider: "local" | "s3" | null;
        fileIds: string[];
      }
    >();
    for (const row of rows) {
      const target = sessions.get(row.id) ?? {
        shareId: row.share_id,
        submissionId: row.submission_id,
        status: row.status,
        storageProvider: row.storage_provider,
        fileIds: [],
      };
      if (row.file_id) target.fileIds.push(row.file_id);
      sessions.set(row.id, target);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [id, target] of sessions) {
        if (target.status === "processing" && target.storageProvider) {
          this.insertObjectDeletions(
            target.fileIds.map((storedName) => ({
              stored_name: storedName,
              storage_provider: target.storageProvider!,
            })),
          );
        }
        if (!["completed", "quarantined"].includes(target.status)) {
          if (target.shareId) {
            this.db.prepare("DELETE FROM shares WHERE id = ?").run(target.shareId);
          }
          if (target.submissionId) {
            this.db
              .prepare("DELETE FROM reverse_submissions WHERE id = ?")
              .run(target.submissionId);
          }
        }
        this.db.prepare("DELETE FROM upload_sessions WHERE id = ?").run(id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return rows
      .map((row) => row.temp_name)
      .filter((value): value is string => Boolean(value));
  }

  shareEmailDeliveryCount(userId: string, since: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM email_delivery_events
         WHERE user_id = ?
           AND kind = 'share'
           AND created_at >= ?`,
      )
      .get(userId, since) as { count: number };
    return row.count;
  }

  recordShareEmailDelivery(
    userId: string,
    shareId: string,
    auditEventId: number,
    createdAt = Date.now(),
  ): void {
    this.db
      .prepare(
        `INSERT INTO email_delivery_events (
          user_id, share_id, kind, created_at, audit_event_id
        ) VALUES (?, ?, 'share', ?, ?)`,
      )
      .run(userId, shareId, createdAt, auditEventId);
  }

  createReverseShare(value: ReverseShareRecord): void {
    this.db
      .prepare(
        `INSERT INTO reverse_shares (
          id, owner_id, token_hash, token_encrypted, title, description,
          password_hash, password_salt, expires_at, max_files, max_total_size,
          max_submissions, submission_count, enabled, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.owner_id,
        value.token_hash,
        value.token_encrypted,
        value.title,
        value.description,
        value.password_hash,
        value.password_salt,
        value.expires_at,
        value.max_files,
        value.max_total_size,
        value.max_submissions,
        value.submission_count,
        value.enabled,
        value.created_at,
      );
  }

  findReverseShareByToken(tokenHash: string): ReverseShareRecord | undefined {
    return this.db
      .prepare(
        `SELECT reverse_shares.* FROM reverse_shares
         JOIN users ON users.id = reverse_shares.owner_id
         WHERE reverse_shares.token_hash = ? AND users.disabled_at IS NULL`,
      )
      .get(tokenHash) as ReverseShareRecord | undefined;
  }

  findReverseShareForOwner(
    ownerId: string,
    id: string,
  ): ReverseShareRecord | undefined {
    return this.db
      .prepare("SELECT * FROM reverse_shares WHERE id = ? AND owner_id = ?")
      .get(id, ownerId) as ReverseShareRecord | undefined;
  }

  listReverseShares(ownerId: string): ReverseShareRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM reverse_shares WHERE owner_id = ? ORDER BY created_at DESC",
      )
      .all(ownerId) as unknown as ReverseShareRecord[];
  }

  setReverseShareEnabled(
    ownerId: string,
    id: string,
    enabled: boolean,
  ): boolean {
    const result = this.db
      .prepare(
        "UPDATE reverse_shares SET enabled = ? WHERE id = ? AND owner_id = ?",
      )
      .run(enabled ? 1 : 0, id, ownerId);
    return result.changes === 1;
  }

  rotateReverseShareToken(
    ownerId: string,
    id: string,
    tokenHash: string,
    encryptedToken: string,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE reverse_shares
         SET token_hash = ?, token_encrypted = ?
         WHERE id = ? AND owner_id = ?`,
      )
      .run(tokenHash, encryptedToken, id, ownerId);
    return result.changes === 1;
  }

  listReverseSubmissions(ownerId: string): ReverseSubmissionRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM reverse_submissions
         WHERE owner_id = ? ORDER BY created_at DESC`,
      )
      .all(ownerId) as unknown as ReverseSubmissionRecord[];
  }

  findReverseSubmission(id: string): ReverseSubmissionRecord | undefined {
    return this.db
      .prepare("SELECT * FROM reverse_submissions WHERE id = ?")
      .get(id) as ReverseSubmissionRecord | undefined;
  }

  listSubmissionFiles(
    ownerId: string,
    submissionId: string,
  ): SubmissionFileRecord[] {
    return this.db
      .prepare(
        `SELECT submission_files.*
         FROM submission_files
         JOIN reverse_submissions
           ON reverse_submissions.id = submission_files.submission_id
         WHERE submission_files.submission_id = ?
           AND reverse_submissions.owner_id = ?
         ORDER BY relative_path COLLATE NOCASE, original_name COLLATE NOCASE`,
      )
      .all(submissionId, ownerId) as unknown as SubmissionFileRecord[];
  }

  findSubmissionFile(
    ownerId: string,
    submissionId: string,
    fileId: string,
  ): SubmissionFileRecord | undefined {
    return this.db
      .prepare(
        `SELECT submission_files.*
         FROM submission_files
         JOIN reverse_submissions
           ON reverse_submissions.id = submission_files.submission_id
         WHERE submission_files.submission_id = ?
           AND submission_files.id = ?
           AND reverse_submissions.owner_id = ?`,
      )
      .get(submissionId, fileId, ownerId) as
      | SubmissionFileRecord
      | undefined;
  }

  deleteReverseSubmission(
    ownerId: string,
    submissionId: string,
  ): StoredObjectReference[] | undefined {
    const submission = this.db
      .prepare(
        "SELECT reverse_share_id FROM reverse_submissions WHERE id = ? AND owner_id = ?",
      )
      .get(submissionId, ownerId) as
      | { reverse_share_id: string }
      | undefined;
    if (!submission) return undefined;
    const objects = this.db
      .prepare(
        `SELECT stored_name, storage_provider
         FROM submission_files WHERE submission_id = ?`,
      )
      .all(submissionId) as unknown as StoredObjectReference[];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.insertObjectDeletions(objects);
      this.db
        .prepare("DELETE FROM reverse_submissions WHERE id = ? AND owner_id = ?")
        .run(submissionId, ownerId);
      this.db
        .prepare(
          `UPDATE reverse_shares
           SET submission_count = MAX(0, submission_count - 1)
           WHERE id = ?`,
        )
        .run(submission.reverse_share_id);
      this.db.exec("COMMIT");
      return objects;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  deleteReverseShare(
    ownerId: string,
    id: string,
  ): StoredObjectReference[] | undefined {
    const existing = this.findReverseShareForOwner(ownerId, id);
    if (!existing) return undefined;
    const objects = this.db
      .prepare(
        `SELECT submission_files.stored_name,
                submission_files.storage_provider
         FROM submission_files
         JOIN reverse_submissions
           ON reverse_submissions.id = submission_files.submission_id
         WHERE reverse_submissions.reverse_share_id = ?`,
      )
      .all(id) as unknown as StoredObjectReference[];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.insertObjectDeletions(objects);
      this.db
        .prepare("DELETE FROM reverse_shares WHERE id = ? AND owner_id = ?")
        .run(id, ownerId);
      this.db.exec("COMMIT");
      return objects;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listUploadTempNamesForReverse(id: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT upload_files.temp_name
           FROM upload_files
           JOIN upload_sessions
             ON upload_sessions.id = upload_files.upload_id
           WHERE upload_sessions.reverse_share_id = ?`,
        )
        .all(id) as unknown as Array<{ temp_name: string }>
    ).map((row) => row.temp_name);
  }

  createInvitation(value: InvitationRecord): void {
    this.db
      .prepare(
        `INSERT INTO invitations (
          id, token_hash, token_encrypted, email, created_by, expires_at,
          max_uses, use_count, revoked_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.token_hash,
        value.token_encrypted,
        value.email,
        value.created_by,
        value.expires_at,
        value.max_uses,
        value.use_count,
        value.revoked_at,
        value.created_at,
      );
  }

  listInvitations(): InvitationRecord[] {
    return this.db
      .prepare("SELECT * FROM invitations ORDER BY created_at DESC")
      .all() as unknown as InvitationRecord[];
  }

  findInvitationByToken(tokenHash: string): InvitationRecord | undefined {
    return this.db
      .prepare("SELECT * FROM invitations WHERE token_hash = ?")
      .get(tokenHash) as InvitationRecord | undefined;
  }

  revokeInvitation(id: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE invitations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      )
      .run(Date.now(), id);
    return result.changes === 1;
  }

  createUserFromInvitation(
    invitationTokenHash: string,
    user: UserRecord,
    verificationTokenHash: string,
    verificationExpiresAt: number,
  ): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const invitation = this.findInvitationByToken(invitationTokenHash);
      if (
        !invitation ||
        invitation.revoked_at !== null ||
        invitation.expires_at <= Date.now() ||
        invitation.use_count >= invitation.max_uses ||
        (invitation.email !== null &&
          invitation.email.toLowerCase() !== user.email.toLowerCase())
      ) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.createUser(user);
      this.db
        .prepare(
          `INSERT INTO email_verification_tokens
            (token_hash, user_id, created_at, expires_at, used_at)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .run(
          verificationTokenHash,
          user.id,
          Date.now(),
          verificationExpiresAt,
        );
      const consumed = this.db
        .prepare(
          `UPDATE invitations SET use_count = use_count + 1
           WHERE id = ? AND use_count < max_uses AND revoked_at IS NULL`,
        )
        .run(invitation.id);
      if (consumed.changes !== 1) {
        throw new Error("Invitation could not be consumed.");
      }
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listGlobalShares(): GlobalShareRecord[] {
    return this.db
      .prepare(
        `SELECT shares.id, shares.owner_id, users.email AS owner_email,
                shares.status, shares.source, shares.created_at,
                shares.expires_at, COUNT(files.id) AS file_count,
                shares.total_size
         FROM shares
         LEFT JOIN users ON users.id = shares.owner_id
         LEFT JOIN files ON files.share_id = shares.id
         GROUP BY shares.id
         ORDER BY shares.created_at DESC`,
      )
      .all() as unknown as GlobalShareRecord[];
  }

  revokeGlobalShare(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE shares SET status = 'failed', expires_at = ?
         WHERE id = ? AND status != 'failed'`,
      )
      .run(Date.now(), id);
    return result.changes === 1;
  }

  createOidcState(
    stateHash: string,
    encryptedVerifier: string,
    nonce: string,
    userId: string | null,
    mode: "login" | "link",
    expiresAt: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO oidc_states (
          state_hash, code_verifier_encrypted, nonce, user_id, mode,
          created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        stateHash,
        encryptedVerifier,
        nonce,
        userId,
        mode,
        Date.now(),
        expiresAt,
      );
  }

  consumeOidcState(
    stateHash: string,
  ):
    | {
        code_verifier_encrypted: string;
        nonce: string;
        user_id: string | null;
        mode: "login" | "link";
      }
    | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.db
        .prepare(
          `SELECT code_verifier_encrypted, nonce, user_id, mode
           FROM oidc_states
           WHERE state_hash = ? AND expires_at > ?`,
        )
        .get(stateHash, Date.now()) as
        | {
            code_verifier_encrypted: string;
            nonce: string;
            user_id: string | null;
            mode: "login" | "link";
          }
        | undefined;
      if (!state) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      this.db.prepare("DELETE FROM oidc_states WHERE state_hash = ?").run(stateHash);
      this.db.exec("COMMIT");
      return state;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  findUserByOidcIdentity(
    issuer: string,
    subject: string,
  ): UserRecord | undefined {
    return this.db
      .prepare(
        `SELECT users.* FROM oidc_identities
         JOIN users ON users.id = oidc_identities.user_id
         WHERE oidc_identities.issuer = ? AND oidc_identities.subject = ?`,
      )
      .get(issuer, subject) as UserRecord | undefined;
  }

  linkOidcIdentity(
    userId: string,
    identity: OidcIdentityRecord,
  ): boolean {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO oidc_identities (
            issuer, subject, user_id, email, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          identity.issuer,
          identity.subject,
          userId,
          identity.email,
          identity.created_at,
        );
      return result.changes === 1;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed")
      ) {
        return false;
      }
      throw error;
    }
  }

  createOidcUser(user: UserRecord, identity: OidcIdentityRecord): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.findUserByEmail(user.email)) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.createUser(user);
      this.db
        .prepare(
          `INSERT INTO oidc_identities (
            issuer, subject, user_id, email, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          identity.issuer,
          identity.subject,
          user.id,
          identity.email,
          identity.created_at,
        );
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  userCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM users").get() as {
      count: number;
    };
    return row.count;
  }

  createUser(user: UserRecord): void {
    this.db
      .prepare(
        `INSERT INTO users (
          id, email, password_hash, password_salt, totp_secret, totp_enabled,
          role, email_verified_at, disabled_at, quota_bytes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        user.email.toLowerCase(),
        user.password_hash,
        user.password_salt,
        user.totp_secret,
        user.totp_enabled,
        user.role,
        user.email_verified_at,
        user.disabled_at,
        user.quota_bytes,
        user.created_at,
      );
  }

  createInitialUser(user: UserRecord): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.userCount() > 0) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.createUser(user);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createUnverifiedUser(
    user: UserRecord,
    tokenHash: string,
    expiresAt: number,
  ): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.createUser(user);
      this.db
        .prepare(
          `INSERT INTO email_verification_tokens
            (token_hash, user_id, created_at, expires_at, used_at)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .run(tokenHash, user.id, Date.now(), expiresAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  findUserByEmail(email: string): UserRecord | undefined {
    return this.db
      .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
      .get(email.toLowerCase()) as UserRecord | undefined;
  }

  findUserById(id: string): UserRecord | undefined {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | UserRecord
      | undefined;
  }

  listUsers(): ManagedUserRecord[] {
    return this.db
      .prepare(
        `SELECT users.id, users.email, users.role, users.email_verified_at,
           users.disabled_at, users.totp_enabled, users.created_at,
           users.quota_bytes,
           (SELECT COUNT(*) FROM shares WHERE shares.owner_id = users.id)
             AS share_count,
           COALESCE((
             SELECT SUM(files.size) FROM files
             JOIN shares ON shares.id = files.share_id
             WHERE shares.owner_id = users.id
           ), 0) +
           COALESCE((
             SELECT SUM(submission_files.size) FROM submission_files
             JOIN reverse_submissions
               ON reverse_submissions.id = submission_files.submission_id
             WHERE reverse_submissions.owner_id = users.id
           ), 0) +
           COALESCE((
             SELECT SUM(upload_sessions.expected_size) FROM upload_sessions
             WHERE upload_sessions.owner_id = users.id
               AND upload_sessions.status IN ('uploading', 'processing')
               AND upload_sessions.expires_at > unixepoch('now') * 1000
           ), 0) AS total_size
         FROM users
         ORDER BY users.created_at ASC`,
      )
      .all() as unknown as ManagedUserRecord[];
  }

  replaceEmailVerificationToken(
    userId: string,
    tokenHash: string,
    expiresAt: number,
  ): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("DELETE FROM email_verification_tokens WHERE user_id = ?")
        .run(userId);
      this.db
        .prepare(
          `INSERT INTO email_verification_tokens
            (token_hash, user_id, created_at, expires_at, used_at)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .run(tokenHash, userId, Date.now(), expiresAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  consumeEmailVerificationToken(tokenHash: string): string | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          `SELECT user_id FROM email_verification_tokens
           WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
        )
        .get(tokenHash, Date.now()) as { user_id: string } | undefined;
      if (!row) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      this.db
        .prepare(
          "UPDATE email_verification_tokens SET used_at = ? WHERE token_hash = ?",
        )
        .run(Date.now(), tokenHash);
      this.db
        .prepare(
          `UPDATE users
           SET email_verified_at = COALESCE(email_verified_at, ?)
           WHERE id = ?`,
        )
        .run(Date.now(), row.user_id);
      this.db.exec("COMMIT");
      return row.user_id;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  setUserDisabled(userId: string, disabled: boolean): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare("UPDATE users SET disabled_at = ? WHERE id = ? AND role != 'admin'")
        .run(disabled ? Date.now() : null, userId);
      if (result.changes === 1 && disabled) {
        this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
      }
      this.db.exec("COMMIT");
      return result.changes === 1;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  updatePassword(userId: string, hash: string, salt: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
        .run(hash, salt, userId);
      this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  setPendingTotp(userId: string, encryptedSecret: string): void {
    this.db
      .prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?")
      .run(encryptedSecret, userId);
  }

  enableTotp(userId: string, codeHashes: string[]): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(userId);
      this.db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
      const insert = this.db.prepare(
        "INSERT INTO recovery_codes (user_id, code_hash, used_at) VALUES (?, ?, NULL)",
      );
      for (const hash of codeHashes) insert.run(userId, hash);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  disableTotp(userId: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?",
        )
        .run(userId);
      this.db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  consumeRecoveryCode(userId: string, codeHash: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE recovery_codes SET used_at = ?
         WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
      )
      .run(Date.now(), userId, codeHash);
    return result.changes === 1;
  }

  recoveryCodeCount(userId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ? AND used_at IS NULL",
      )
      .get(userId) as { count: number };
    return row.count;
  }

  createSession(session: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        session.token_hash,
        session.user_id,
        session.created_at,
        session.expires_at,
      );
  }

  findUserForSession(tokenHash: string, now = Date.now()): UserRecord | undefined {
    return this.db
      .prepare(
        `SELECT users.* FROM sessions
         JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?
           AND users.email_verified_at IS NOT NULL
           AND users.disabled_at IS NULL`,
      )
      .get(tokenHash, now) as UserRecord | undefined;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  createPasswordResetToken(
    tokenHash: string,
    userId: string,
    expiresAt: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO password_reset_tokens
          (token_hash, user_id, created_at, expires_at, used_at)
         VALUES (?, ?, ?, ?, NULL)`,
      )
      .run(tokenHash, userId, Date.now(), expiresAt);
  }

  consumePasswordResetToken(tokenHash: string): string | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          `SELECT user_id FROM password_reset_tokens
           WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
        )
        .get(tokenHash, Date.now()) as { user_id: string } | undefined;
      if (!row) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      this.db
        .prepare("DELETE FROM password_reset_tokens WHERE user_id = ?")
        .run(row.user_id);
      this.db.exec("COMMIT");
      return row.user_id;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, Date.now());
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  purgeExpiredSecurityData(now = Date.now()): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    this.db
      .prepare(
        "DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL",
      )
      .run(now);
    this.db
      .prepare(
        "DELETE FROM email_verification_tokens WHERE expires_at <= ? OR used_at IS NOT NULL",
      )
      .run(now);
    this.db.prepare("DELETE FROM oidc_states WHERE expires_at <= ?").run(now);
    this.db
      .prepare(
        "DELETE FROM invitations WHERE expires_at <= ? AND use_count >= max_uses",
      )
      .run(now);
  }

  audit(
    shareId: string | null,
    event: string,
    ipHash: string,
    details?: Record<string, unknown>,
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO audit_events (share_id, event, ip_hash, created_at, details)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        shareId,
        event,
        ipHash,
        Date.now(),
        details ? JSON.stringify(details) : null,
      );
    return Number(result.lastInsertRowid);
  }
}
