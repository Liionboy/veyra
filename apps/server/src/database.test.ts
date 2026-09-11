import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { VeyraDatabase, type UserRecord } from "./database.js";

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "veyra-database-"));
  return {
    directory,
    path: join(directory, "veyra.db"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function user(
  id: string,
  email: string,
  role: "admin" | "member",
  verified: boolean,
): UserRecord {
  const now = Date.now();
  return {
    id,
    email,
    password_hash: "hash",
    password_salt: "salt",
    totp_secret: null,
    totp_enabled: 0,
    role,
    email_verified_at: verified ? now : null,
    disabled_at: null,
    quota_bytes: null,
    created_at: now,
  };
}

test("legacy single-user databases migrate the existing account to verified admin", () => {
  const temporary = temporaryDatabase();
  const legacy = new DatabaseSync(temporary.path);
  const createdAt = Date.now() - 1_000;
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  legacy
    .prepare(
      `INSERT INTO users
        (id, email, password_hash, password_salt, totp_secret, totp_enabled, created_at)
       VALUES (?, ?, ?, ?, NULL, 0, ?)`,
    )
    .run("legacy-admin", "admin@example.test", "hash", "salt", createdAt);
  legacy.close();

  const database = new VeyraDatabase(temporary.path);
  const migrated = database.findUserByEmail("ADMIN@example.test");
  assert.equal(migrated?.role, "admin");
  assert.equal(migrated?.email_verified_at, createdAt);
  assert.equal(migrated?.disabled_at, null);
  database.close();
  temporary.cleanup();
});

test("unverified and disabled members cannot use sessions", () => {
  const temporary = temporaryDatabase();
  const database = new VeyraDatabase(temporary.path);
  const admin = user("admin", "admin@example.test", "admin", true);
  assert.equal(database.createInitialUser(admin), true);
  assert.equal(
    database.createInitialUser(user("second", "second@example.test", "admin", true)),
    false,
  );

  const member = user("member", "member@example.test", "member", false);
  database.createUnverifiedUser(member, "verification-token-hash", Date.now() + 60_000);
  database.createSession({
    token_hash: "member-session",
    user_id: member.id,
    created_at: Date.now(),
    expires_at: Date.now() + 60_000,
  });
  assert.equal(database.findUserForSession("member-session"), undefined);
  assert.equal(
    database.consumeEmailVerificationToken("verification-token-hash"),
    member.id,
  );
  assert.equal(database.findUserForSession("member-session")?.id, member.id);
  assert.equal(database.setUserDisabled(member.id, true), true);
  assert.equal(database.findUserForSession("member-session"), undefined);
  assert.equal(database.setUserDisabled(admin.id, true), false);

  database.close();
  temporary.cleanup();
});

test("users can list and revoke only their own active sessions", () => {
  const temporary = temporaryDatabase();
  const database = new VeyraDatabase(temporary.path);
  const admin = user("admin", "admin@example.test", "admin", true);
  const member = user("member", "member@example.test", "member", true);
  assert.equal(database.createInitialUser(admin), true);
  database.createUnverifiedUser(member, "verification-token", Date.now() + 60_000);
  database.consumeEmailVerificationToken("verification-token");
  const now = Date.now();
  database.createSession({
    token_hash: "admin-session-current",
    user_id: admin.id,
    created_at: now - 2_000,
    expires_at: now + 60_000,
  });
  database.createSession({
    token_hash: "admin-session-expired",
    user_id: admin.id,
    created_at: now - 3_000,
    expires_at: now - 1,
  });
  database.createSession({
    token_hash: "member-session",
    user_id: member.id,
    created_at: now - 1_000,
    expires_at: now + 60_000,
  });

  assert.deepEqual(database.listSessionsForUser(admin.id, now).map((entry) => ({ ...entry })), [
    {
      token_hash: "admin-session-current",
      created_at: now - 2_000,
      expires_at: now + 60_000,
    },
  ]);
  assert.equal(database.deleteSessionForUser(admin.id, "member-session"), false);
  assert.equal(database.deleteSessionForUser(admin.id, "admin-session-current"), true);
  assert.deepEqual(database.listSessionsForUser(admin.id, now).map((entry) => ({ ...entry })), []);

  database.close();
  temporary.cleanup();
});

test("using one password reset token invalidates every token for that user", () => {
  const temporary = temporaryDatabase();
  const database = new VeyraDatabase(temporary.path);
  const admin = user("admin", "admin@example.test", "admin", true);
  assert.equal(database.createInitialUser(admin), true);
  database.createPasswordResetToken("first", admin.id, Date.now() + 60_000);
  database.createPasswordResetToken("second", admin.id, Date.now() + 60_000);

  assert.equal(database.consumePasswordResetToken("first"), admin.id);
  assert.equal(database.consumePasswordResetToken("second"), undefined);

  database.close();
  temporary.cleanup();
});

test("deleting a share does not reset its email delivery count", () => {
  const temporary = temporaryDatabase();
  const database = new VeyraDatabase(temporary.path);
  const admin = user("admin", "admin@example.test", "admin", true);
  assert.equal(database.createInitialUser(admin), true);
  const now = Date.now();
  database.createShare({
    share: {
      id: "emailed-share",
      token_hash: "token-hash",
      token_encrypted: "encrypted-token",
      owner_id: admin.id,
      created_at: now,
      expires_at: null,
      max_downloads: null,
      download_count: 0,
      password_hash: null,
      password_salt: null,
      note: null,
      title: "Delivery test",
      description: null,
      recipient_email: "recipient@example.test",
      status: "ready",
      source: "outbound",
      reverse_share_id: null,
      sender_name: null,
      sender_email: null,
      total_size: 0,
    },
    files: [],
  });
  const auditEventId = database.audit(
    "emailed-share",
    "share.email_sent",
    "anonymous",
  );
  database.recordShareEmailDelivery(
    admin.id,
    "emailed-share",
    auditEventId,
    now,
  );

  assert.equal(database.shareEmailDeliveryCount(admin.id, now - 1), 1);
  assert.deepEqual(database.deleteManagedShare(admin.id, "emailed-share"), []);
  assert.equal(database.shareEmailDeliveryCount(admin.id, now - 1), 1);

  database.close();
  temporary.cleanup();
});
