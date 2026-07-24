import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  type ReverseShareRecord,
  type UserRecord,
  VeyraDatabase,
} from "./database.js";
import {
  saveAntivirusSettings,
  saveCapacityPolicy,
} from "./settings.js";
import {
  archivePath,
  LocalStorage,
  parseByteRange,
  safeRelativePath,
  StorageManager,
} from "./storage.js";
import { UploadService } from "./uploads.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "veyra-upload-"));
  const database = new VeyraDatabase(join(directory, "veyra.db"));
  const user: UserRecord = {
    id: "test-user",
    email: "owner@example.test",
    password_hash: "hash",
    password_salt: "salt",
    totp_secret: null,
    totp_enabled: 0,
    role: "member",
    email_verified_at: Date.now(),
    disabled_at: null,
    quota_bytes: null,
    created_at: Date.now(),
  };
  database.createUser(user);
  saveCapacityPolicy(database, {
    maxShareBytes: 1024 * 1024,
    defaultUserQuotaBytes: 1024 * 1024,
    instanceQuotaBytes: 2 * 1024 * 1024,
    minimumFreeBytes: 0,
    maxFilesPerShare: 100,
  });
  const storage = new StorageManager(directory, () => ({ backend: "local" }));
  const uploads = new UploadService(database, storage);
  return {
    directory,
    database,
    storage,
    uploads,
    user,
    cleanup() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("folder paths are normalized and archive entries cannot escape", () => {
  assert.equal(safeRelativePath("photos/2026/image.jpg"), "photos/2026");
  assert.equal(
    safeRelativePath("../../private\\summer\\image.jpg"),
    "private/summer",
  );
  assert.equal(archivePath("../private", "../../image.jpg"), "private/.._.._image.jpg");
  assert.deepEqual(parseByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9 });
});

test("local resumable writes enforce offsets and support byte ranges", async () => {
  const directory = mkdtempSync(join(tmpdir(), "veyra-storage-"));
  const storage = new LocalStorage(directory);
  await storage.createTemporary("upload");
  assert.equal(
    await storage.appendTemporary(
      "upload",
      Readable.from(Buffer.from("hello")),
      0,
      5,
    ),
    5,
  );
  await assert.rejects(
    storage.appendTemporary(
      "upload",
      Readable.from(Buffer.from("!")),
      0,
      1,
    ),
    /offset mismatch/i,
  );
  await storage.commitTemporary("upload", "object");
  const opened = await storage.open("object", { start: 1, end: 3 });
  const chunks: Buffer[] = [];
  for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(chunks).toString(), "ell");
  assert.deepEqual(opened.range, { start: 1, end: 3 });
  rmSync(directory, { recursive: true, force: true });
});

test("share uploads reserve quota, resume by offset, and publish atomically", async () => {
  const value = fixture();
  try {
    const first = Buffer.from("hello ");
    const second = Buffer.from("world");
    const session = await value.uploads.createShareUpload(value.user, {
      files: [
        {
          name: "greeting.txt",
          relativePath: "folder/greeting.txt",
          type: "text/plain",
          size: first.length,
        },
        {
          name: "world.txt",
          relativePath: "folder/world.txt",
          type: "text/plain",
          size: second.length,
        },
      ],
      options: {
        expiresInHours: 24,
        maxDownloads: null,
        title: "Folder",
      },
    });
    assert.equal(value.database.capacityUsage(value.user.id).reservedBytes, 11);

    await value.uploads.append(
      value.database.findUploadSession(session.id)!,
      session.files[0]!.id,
      0,
      first.length,
      Readable.from(first),
    );
    await assert.rejects(
      value.uploads.append(
        value.database.findUploadSession(session.id)!,
        session.files[0]!.id,
        0,
        1,
        Readable.from(Buffer.from("x")),
      ),
      /Resume from byte 6/,
    );
    await value.uploads.append(
      value.database.findUploadSession(session.id)!,
      session.files[1]!.id,
      0,
      second.length,
      Readable.from(second),
    );

    const finalized = await value.uploads.finalize(
      value.database.findUploadSession(session.id)!,
    );
    assert.equal(finalized.kind, "share");
    assert.equal(finalized.scanStatus, "disabled");
    assert.equal(finalized.share?.status, "ready");
    const files = value.database.listFiles(finalized.share!.id);
    assert.deepEqual(
      files.map((file) => file.relative_path),
      ["folder", "folder"],
    );
    assert.ok(files.every((file) => file.storage_provider === "local"));
    assert.deepEqual(
      files.map((file) =>
        readFileSync(value.storage.local.pathFor(file.stored_name), "utf8"),
      ),
      ["hello ", "world"],
    );
    assert.deepEqual(value.database.capacityUsage(value.user.id), {
      committedBytes: 11,
      reservedBytes: 0,
      totalBytes: 11,
    });
  } finally {
    value.cleanup();
  }
});

test("user quota reservations reject a second upload before bytes are written", async () => {
  const value = fixture();
  try {
    assert.equal(value.database.setUserQuota(value.user.id, 10), true);
    await value.uploads.createShareUpload(value.user, {
      files: [
        {
          name: "first.bin",
          relativePath: "first.bin",
          type: "application/octet-stream",
          size: 6,
        },
      ],
      options: { expiresInHours: 24, maxDownloads: null },
    });
    await assert.rejects(
      value.uploads.createShareUpload(value.user, {
        files: [
          {
            name: "second.bin",
            relativePath: "second.bin",
            type: "application/octet-stream",
            size: 6,
          },
        ],
        options: { expiresInHours: 24, maxDownloads: null },
      }),
      /storage quota/i,
    );
    assert.equal(value.database.capacityUsage(value.user.id).reservedBytes, 6);
  } finally {
    value.cleanup();
  }
});

test("resumable uploads reconcile disk progress and recover processing sessions", async () => {
  const value = fixture();
  try {
    const payload = Buffer.from("recoverable");
    const session = await value.uploads.createShareUpload(value.user, {
      files: [
        {
          name: "recover.txt",
          relativePath: "recover.txt",
          type: "text/plain",
          size: payload.length,
        },
      ],
      options: { expiresInHours: 24, maxDownloads: null },
    });
    const uploadFile = value.database.findUploadFile(
      session.id,
      session.files[0]!.id,
    )!;

    // Simulate a process crash after bytes reached disk but before SQLite moved.
    await value.storage.local.appendTemporary(
      uploadFile.temp_name,
      Readable.from(payload.subarray(0, 4)),
      0,
      4,
    );
    assert.equal(
      value.database.findUploadFile(session.id, uploadFile.id)?.received_size,
      0,
    );
    assert.equal(
      await value.uploads.offset(
        value.database.findUploadSession(session.id)!,
        uploadFile.id,
      ),
      4,
    );
    await value.uploads.append(
      value.database.findUploadSession(session.id)!,
      uploadFile.id,
      4,
      payload.length - 4,
      Readable.from(payload.subarray(4)),
    );

    // Simulate a restart after the durable processing transition.
    assert.equal(
      value.database.markUploadProcessing(session.id, "local"),
      true,
    );
    const finalized = await value.uploads.finalize(
      value.database.findUploadSession(session.id)!,
    );
    assert.equal(finalized.share?.status, "ready");
    assert.equal(finalized.alreadyCompleted, false);
    const retry = await value.uploads.finalize(
      value.database.findUploadSession(session.id)!,
    );
    assert.equal(retry.alreadyCompleted, true);
    assert.equal(value.database.listFiles(finalized.share!.id).length, 1);
  } finally {
    value.cleanup();
  }
});

test("share deletion records a durable object deletion before metadata is removed", async () => {
  const value = fixture();
  try {
    const payload = Buffer.from("delete me");
    const session = await value.uploads.createShareUpload(value.user, {
      files: [
        {
          name: "delete.txt",
          relativePath: "delete.txt",
          type: "text/plain",
          size: payload.length,
        },
      ],
      options: { expiresInHours: 24, maxDownloads: null },
    });
    await value.uploads.append(
      value.database.findUploadSession(session.id)!,
      session.files[0]!.id,
      0,
      payload.length,
      Readable.from(payload),
    );
    const finalized = await value.uploads.finalize(
      value.database.findUploadSession(session.id)!,
    );
    const object = value.database.listFiles(finalized.share!.id)[0]!;
    assert.deepEqual(
      value.database
        .deleteManagedShare(value.user.id, finalized.share!.id)
        ?.map((entry) => ({ ...entry })),
      [
        {
          stored_name: object.stored_name,
          storage_provider: "local",
        },
      ],
    );
    assert.equal(value.database.findShareById(finalized.share!.id), undefined);
    assert.deepEqual(
      value.database.listPendingObjectDeletions().map((entry) => ({
        stored_name: entry.stored_name,
        storage_provider: entry.storage_provider,
      })),
      [
        {
          stored_name: object.stored_name,
          storage_provider: "local",
        },
      ],
    );
  } finally {
    value.cleanup();
  }
});

test("reverse uploads finalize into the owner's private inbox", async () => {
  const value = fixture();
  try {
    const request: ReverseShareRecord = {
      id: "reverse-request",
      owner_id: value.user.id,
      token_hash: "token-hash",
      token_encrypted: "encrypted-token",
      title: "Send documents",
      description: null,
      password_hash: null,
      password_salt: null,
      expires_at: Date.now() + 60_000,
      max_files: 5,
      max_total_size: 1_000,
      max_submissions: 2,
      submission_count: 0,
      enabled: 1,
      created_at: Date.now(),
    };
    value.database.createReverseShare(request);
    const payload = Buffer.from("private");
    const session = await value.uploads.createReverseUpload(request, {
      files: [
        {
          name: "private.txt",
          relativePath: "documents/private.txt",
          type: "text/plain",
          size: payload.length,
        },
      ],
      senderName: "Sender",
      senderEmail: "sender@example.test",
      message: "For your eyes only.",
    });
    assert.ok(session.uploadToken);
    await value.uploads.append(
      value.database.findUploadSession(session.id)!,
      session.files[0]!.id,
      0,
      payload.length,
      Readable.from(payload),
    );
    const result = await value.uploads.finalize(
      value.database.findUploadSession(session.id)!,
    );
    assert.equal(result.kind, "submission");
    const submissions = value.database.listReverseSubmissions(value.user.id);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0]?.status, "ready");
    assert.equal(value.database.listManagedShares(value.user.id).length, 0);
    const files = value.database.listSubmissionFiles(
      value.user.id,
      submissions[0]!.id,
    );
    assert.equal(files[0]?.relative_path, "documents");
    assert.equal(
      readFileSync(value.storage.local.pathFor(files[0]!.stored_name), "utf8"),
      "private",
    );
  } finally {
    value.cleanup();
  }
});

test("infected uploads are quarantined and never become public", async () => {
  const scanner = createServer((socket) => {
    socket.on("data", () => undefined);
    socket.on("end", () => {
      socket.end("stream: Eicar-Test-Signature FOUND\0");
    });
  });
  await new Promise<void>((resolve, reject) => {
    scanner.once("error", reject);
    scanner.listen(0, "127.0.0.1", resolve);
  });
  const address = scanner.address();
  assert.ok(address && typeof address !== "string");

  const value = fixture();
  try {
    saveAntivirusSettings(value.database, {
      enabled: true,
      host: "127.0.0.1",
      port: address.port,
      timeoutMs: 5_000,
    });
    const payload = Buffer.from("EICAR test fixture");
    const session = await value.uploads.createShareUpload(value.user, {
      files: [
        {
          name: "infected.bin",
          relativePath: "infected.bin",
          type: "application/octet-stream",
          size: payload.length,
        },
      ],
      options: { expiresInHours: 24, maxDownloads: null },
    });
    await value.uploads.append(
      value.database.findUploadSession(session.id)!,
      session.files[0]!.id,
      0,
      payload.length,
      Readable.from(payload),
    );
    await assert.rejects(
      value.uploads.finalize(value.database.findUploadSession(session.id)!),
      /quarantined/i,
    );
    const upload = value.database.findUploadSession(session.id);
    assert.equal(upload?.status, "quarantined");
    const share = value.database.findShareById(upload!.share_id!);
    assert.equal(share?.status, "quarantined");
    const files = value.database.listFiles(share!.id);
    assert.equal(files[0]?.storage_provider, "quarantine");
    assert.equal(files[0]?.scan_status, "infected");
    assert.match(files[0]?.quarantine_reason ?? "", /Eicar-Test-Signature/);
    assert.equal(
      readFileSync(
        value.storage.local.quarantinePath(files[0]!.stored_name),
        "utf8",
      ),
      payload.toString(),
    );
  } finally {
    value.cleanup();
    await new Promise<void>((resolve) => scanner.close(() => resolve()));
  }
});
