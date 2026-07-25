import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { ShareEmailDetails } from "./email.js";

const directory = mkdtempSync(join(tmpdir(), "veyra-app-"));
process.env.NODE_ENV = "test";
process.env.VEYRA_DATA_DIR = directory;
process.env.VEYRA_BASE_URL = "http://localhost:8080";
process.env.VEYRA_SECRET = "test-secret-that-is-at-least-thirty-two-characters";
process.env.VEYRA_IP_SALT = "test-ip-salt-that-is-long-enough";
process.env.VEYRA_MIN_FREE_BYTES = "0";
process.env.VEYRA_DEFAULT_USER_QUOTA = String(1024 * 1024);
process.env.VEYRA_MAX_SHARE_SIZE = String(1024 * 1024);
process.env.VEYRA_MAX_FILE_SIZE = String(1024 * 1024);
process.env.VEYRA_UPLOAD_CHUNK_SIZE = String(1024 * 1024);

const { buildApp } = await import("./app.js");

function cookieValue(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  assert.ok(value);
  return value.split(";")[0]!;
}

test("resumable shares, preview, ZIP, reverse inbox, and admin privacy work end to end", async () => {
  const deliveredShareEmails: Array<{
    recipient: string;
    share: ShareEmailDetails;
  }> = [];
  const app = buildApp({
    sendShareEmail: async (_settings, recipient, shareDetails) => {
      deliveredShareEmails.push({
        recipient,
        share: { ...shareDetails },
      });
    },
  });
  await app.ready();
  try {
    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/auth/setup",
      payload: {
        email: "admin@example.test",
        password: "correct horse battery staple",
      },
    });
    assert.equal(setup.statusCode, 201, setup.body);
    const cookie = cookieValue(setup.headers["set-cookie"]);
    const authenticated = { cookie };

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: authenticated,
      payload: {
        files: [
          {
            name: "hello.txt",
            relativePath: "docs/hello.txt",
            type: "text/plain",
            size: 5,
          },
        ],
        options: {
          expiresInHours: 24,
          maxDownloads: null,
          title: "Integration share",
        },
      },
    });
    assert.equal(create.statusCode, 201, create.body);
    const upload = create.json<{
      id: string;
      files: Array<{ id: string }>;
    }>();
    const fileId = upload.files[0]!.id;

    const chunk = await app.inject({
      method: "PATCH",
      url: `/api/v1/uploads/${upload.id}/files/${fileId}`,
      headers: {
        ...authenticated,
        "content-type": "application/offset+octet-stream",
        "upload-offset": "0",
        "content-length": "5",
      },
      payload: Buffer.from("hello"),
    });
    assert.equal(chunk.statusCode, 204, chunk.body);
    assert.equal(chunk.headers["upload-offset"], "5");

    const replay = await app.inject({
      method: "PATCH",
      url: `/api/v1/uploads/${upload.id}/files/${fileId}`,
      headers: {
        ...authenticated,
        "content-type": "application/offset+octet-stream",
        "upload-offset": "0",
        "content-length": "1",
      },
      payload: Buffer.from("x"),
    });
    assert.equal(replay.statusCode, 409, replay.body);
    assert.equal(replay.headers["upload-offset"], "5");

    const complete = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${upload.id}/complete`,
      headers: authenticated,
      payload: {},
    });
    assert.equal(complete.statusCode, 200, complete.body);
    const share = complete.json<{ token: string; path: string }>();
    const completeRetry = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${upload.id}/complete`,
      headers: authenticated,
      payload: {},
    });
    assert.equal(completeRetry.statusCode, 200, completeRetry.body);
    assert.equal(
      completeRetry.json<{ token: string }>().token,
      share.token,
    );

    const metadata = await app.inject({
      method: "GET",
      url: `/api/v1/shares/${share.token}`,
    });
    assert.equal(metadata.statusCode, 200, metadata.body);
    const details = metadata.json<{
      files: Array<{
        id: string;
        relativePath: string;
        previewable: boolean;
        directUrl: string;
        previewUrl: string;
      }>;
      downloadAllUrl: string;
      qrUrl: string;
    }>();
    assert.equal(details.files[0]?.relativePath, "docs");
    assert.equal(details.files[0]?.previewable, true);
    assert.ok(details.files[0]?.directUrl);
    assert.ok(details.downloadAllUrl);
    assert.ok(details.qrUrl);

    const preview = await app.inject({
      method: "GET",
      url: details.files[0]!.previewUrl,
      headers: { range: "bytes=1-3" },
    });
    assert.equal(preview.statusCode, 206, preview.body);
    assert.equal(preview.body, "ell");
    assert.equal(preview.headers["content-range"], "bytes 1-3/5");

    const qr = await app.inject({
      method: "GET",
      url: details.qrUrl,
    });
    assert.equal(qr.statusCode, 200, qr.body);
    assert.match(qr.body, /<svg/);

    const zip = await app.inject({
      method: "GET",
      url: details.downloadAllUrl,
    });
    assert.equal(zip.statusCode, 200, zip.body);
    assert.equal(zip.headers["content-type"], "application/zip");
    assert.equal(zip.rawPayload.subarray(0, 2).toString(), "PK");

    const requestResponse = await app.inject({
      method: "POST",
      url: "/api/v1/me/upload-requests",
      headers: authenticated,
      payload: {
        title: "Send documents",
        expiresInHours: 24,
        maxFiles: 3,
        maxTotalSize: 100,
        maxSubmissions: 2,
      },
    });
    assert.equal(requestResponse.statusCode, 201, requestResponse.body);
    const reverseRequest = requestResponse.json<{ id: string; path: string }>();
    const reversePath = reverseRequest.path;
    const reverseToken = reversePath.split("/").pop()!;

    const reverseCreate = await app.inject({
      method: "POST",
      url: `/api/v1/reverse/${reverseToken}/uploads`,
      payload: {
        files: [
          {
            name: "private.txt",
            relativePath: "private.txt",
            type: "text/plain",
            size: 7,
          },
        ],
        senderName: "External sender",
      },
    });
    assert.equal(reverseCreate.statusCode, 201, reverseCreate.body);
    const reverseUpload = reverseCreate.json<{
      id: string;
      uploadToken: string;
      files: Array<{ id: string }>;
    }>();
    const reverseChunk = await app.inject({
      method: "PATCH",
      url: `/api/v1/reverse-uploads/${reverseUpload.id}/files/${reverseUpload.files[0]!.id}`,
      headers: {
        "upload-token": reverseUpload.uploadToken,
        "content-type": "application/offset+octet-stream",
        "upload-offset": "0",
        "content-length": "7",
      },
      payload: Buffer.from("private"),
    });
    assert.equal(reverseChunk.statusCode, 204, reverseChunk.body);
    const reverseComplete = await app.inject({
      method: "POST",
      url: `/api/v1/reverse-uploads/${reverseUpload.id}/complete`,
      headers: { "upload-token": reverseUpload.uploadToken },
      payload: {},
    });
    assert.equal(reverseComplete.statusCode, 200, reverseComplete.body);
    const reverseCompleteRetry = await app.inject({
      method: "POST",
      url: `/api/v1/reverse-uploads/${reverseUpload.id}/complete`,
      headers: { "upload-token": reverseUpload.uploadToken },
      payload: {},
    });
    assert.equal(
      reverseCompleteRetry.statusCode,
      200,
      reverseCompleteRetry.body,
    );

    const secondReverseCreate = await app.inject({
      method: "POST",
      url: `/api/v1/reverse/${reverseToken}/uploads`,
      payload: {
        files: [
          {
            name: "blocked.txt",
            relativePath: "blocked.txt",
            type: "text/plain",
            size: 1,
          },
        ],
      },
    });
    assert.equal(secondReverseCreate.statusCode, 201, secondReverseCreate.body);
    const blockedUpload = secondReverseCreate.json<{
      id: string;
      uploadToken: string;
      files: Array<{ id: string }>;
    }>();
    const disableRequest = await app.inject({
      method: "PATCH",
      url: `/api/v1/me/upload-requests/${reverseRequest.id}`,
      headers: authenticated,
      payload: { enabled: false },
    });
    assert.equal(disableRequest.statusCode, 200, disableRequest.body);
    const blockedChunk = await app.inject({
      method: "PATCH",
      url: `/api/v1/reverse-uploads/${blockedUpload.id}/files/${blockedUpload.files[0]!.id}`,
      headers: {
        "upload-token": blockedUpload.uploadToken,
        "content-type": "application/offset+octet-stream",
        "upload-offset": "0",
        "content-length": "1",
      },
      payload: Buffer.from("x"),
    });
    assert.equal(blockedChunk.statusCode, 410, blockedChunk.body);

    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/me/submissions",
      headers: authenticated,
    });
    assert.equal(inbox.statusCode, 200, inbox.body);
    const submissions = inbox.json<{
      submissions: Array<{ senderName: string; files: Array<{ name: string }> }>;
    }>().submissions;
    const receivedSubmission = submissions.find(
      (submission) => submission.senderName === "External sender",
    );
    assert.ok(receivedSubmission);
    assert.equal(receivedSubmission.files[0]?.name, "private.txt");

    const saveEmailSettings = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/email",
      headers: authenticated,
      payload: {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        user: "",
        password: "",
        fromName: "Veyra",
        fromAddress: "veyra@example.test",
      },
    });
    assert.equal(
      saveEmailSettings.statusCode,
      200,
      saveEmailSettings.body,
    );

    const protectedPassword = `Safe<&>"' passphrase`;
    const protectedCreate = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: authenticated,
      payload: {
        files: [
          {
            name: "protected.txt",
            relativePath: "protected.txt",
            type: "text/plain",
            size: 6,
          },
        ],
        options: {
          expiresInHours: 24,
          maxDownloads: null,
          password: protectedPassword,
          recipientEmail: "recipient@example.test",
          title: "Protected delivery",
        },
      },
    });
    assert.equal(protectedCreate.statusCode, 201, protectedCreate.body);
    const protectedUpload = protectedCreate.json<{
      id: string;
      files: Array<{ id: string }>;
    }>();
    const protectedChunk = await app.inject({
      method: "PATCH",
      url: `/api/v1/uploads/${protectedUpload.id}/files/${protectedUpload.files[0]!.id}`,
      headers: {
        ...authenticated,
        "content-type": "application/offset+octet-stream",
        "upload-offset": "0",
        "content-length": "6",
      },
      payload: Buffer.from("secret"),
    });
    assert.equal(protectedChunk.statusCode, 204, protectedChunk.body);

    const pendingDatabase = new DatabaseSync(join(directory, "veyra.db"), {
      readOnly: true,
    });
    const pendingUpload = pendingDatabase
      .prepare(
        "SELECT share_id, options_json FROM upload_sessions WHERE id = ?",
      )
      .get(protectedUpload.id) as {
      share_id: string;
      options_json: string;
    };
    pendingDatabase.close();
    assert.equal(pendingUpload.options_json.includes(protectedPassword), false);

    const wrongPasswordCompletion = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${protectedUpload.id}/complete`,
      headers: authenticated,
      payload: {
        includePasswordInEmail: true,
        password: "incorrect password",
      },
    });
    assert.equal(
      wrongPasswordCompletion.statusCode,
      400,
      wrongPasswordCompletion.body,
    );
    assert.equal(deliveredShareEmails.length, 0);

    const protectedComplete = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${protectedUpload.id}/complete`,
      headers: authenticated,
      payload: {
        includePasswordInEmail: true,
        password: protectedPassword,
      },
    });
    assert.equal(protectedComplete.statusCode, 200, protectedComplete.body);
    assert.equal(
      protectedComplete.json<{
        emailSent: boolean;
        passwordIncludedInEmail: boolean;
      }>().emailSent,
      true,
    );
    assert.equal(
      protectedComplete.json<{
        passwordIncludedInEmail: boolean;
      }>().passwordIncludedInEmail,
      true,
    );
    assert.equal(protectedComplete.body.includes(protectedPassword), false);
    assert.equal(deliveredShareEmails.length, 1);
    assert.equal(
      deliveredShareEmails[0]?.recipient,
      "recipient@example.test",
    );
    assert.equal(
      deliveredShareEmails[0]?.share.password,
      protectedPassword,
    );

    const protectedRetry = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${protectedUpload.id}/complete`,
      headers: authenticated,
      payload: {
        includePasswordInEmail: true,
        password: protectedPassword,
      },
    });
    assert.equal(protectedRetry.statusCode, 200, protectedRetry.body);
    assert.equal(
      protectedRetry.json<{ passwordIncludedInEmail: boolean }>()
        .passwordIncludedInEmail,
      false,
    );
    assert.equal(deliveredShareEmails.length, 1);

    const resend = await app.inject({
      method: "POST",
      url: `/api/v1/me/shares/${pendingUpload.share_id}/send-email`,
      headers: authenticated,
    });
    assert.equal(resend.statusCode, 200, resend.body);
    assert.equal(deliveredShareEmails.length, 2);
    assert.equal(deliveredShareEmails[1]?.share.password, undefined);

    const global = await app.inject({
      method: "GET",
      url: "/api/v1/admin/global-shares",
      headers: authenticated,
    });
    assert.equal(global.statusCode, 200, global.body);
    assert.match(global.json<{ privacy: string }>().privacy, /aggregate metadata/i);
    assert.equal(global.body.includes("hello.txt"), false);
    assert.equal(global.body.includes(share.token), false);

    const database = new DatabaseSync(join(directory, "veyra.db"), {
      readOnly: true,
    });
    assert.equal(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM audit_events WHERE event = 'share.created'",
          )
          .get() as { count: number }
      ).count,
      2,
    );
    assert.equal(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM audit_events WHERE event = 'reverse_submission.received'",
          )
          .get() as { count: number }
      ).count,
      1,
    );
    database.close();
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
