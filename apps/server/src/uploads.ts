import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { z } from "zod";
import { scanFile } from "./antivirus.js";
import { encryptValue } from "./auth.js";
import { config } from "./config.js";
import {
  type FileRecord,
  type ReverseShareRecord,
  type ShareRecord,
  type SubmissionFileRecord,
  type UploadFileRecord,
  type UploadSessionRecord,
  type UserRecord,
  VeyraDatabase,
} from "./database.js";
import {
  loadAntivirusSettings,
  loadCapacityPolicy,
} from "./settings.js";
import {
  archivePath,
  safeDisplayName,
  safeRelativePath,
  StorageManager,
} from "./storage.js";
import {
  createPublicToken,
  hashPassword,
  hashToken,
} from "./security.js";

export const uploadManifestSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(500),
        relativePath: z.string().max(2_000).default(""),
        type: z.string().max(120).default("application/octet-stream"),
        size: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(2_000),
  options: z.object({
    expiresInHours: z.number().int().min(1).max(24 * 365).nullable().default(168),
    maxDownloads: z.number().int().min(1).max(1_000_000).nullable().default(null),
    password: z.string().min(8).max(256).optional(),
    title: z.string().max(100).optional(),
    description: z.string().max(1_000).optional(),
    recipientEmail: z.string().email().max(254).optional(),
  }),
});

export const reverseUploadManifestSchema = z.object({
  files: uploadManifestSchema.shape.files,
  senderName: z.string().max(100).optional(),
  senderEmail: z.string().email().max(254).optional(),
  message: z.string().max(1_000).optional(),
});

export type UploadManifest = z.infer<typeof uploadManifestSchema>;
export type ReverseUploadManifest = z.infer<typeof reverseUploadManifestSchema>;

export interface CreatedUpload {
  id: string;
  expiresAt: string;
  chunkSize: number;
  uploadToken?: string;
  files: Array<{
    id: string;
    name: string;
    relativePath: string;
    size: number;
    offset: number;
  }>;
}

export interface FinalizedUpload {
  kind: "share" | "submission";
  share: ShareRecord | null;
  publicToken: string | null;
  submissionId: string | null;
  scanStatus: "clean" | "disabled";
  alreadyCompleted: boolean;
}

function statusError(statusCode: number, message: string, code?: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

function normalizeManifestFiles(
  rawFiles: UploadManifest["files"],
): Array<{
  id: string;
  name: string;
  relativePath: string;
  type: string;
  size: number;
  tempName: string;
}> {
  const paths = new Set<string>();
  return rawFiles.map((file) => {
    const name = safeDisplayName(file.name);
    const relativePath = safeRelativePath(file.relativePath || file.name);
    const identity = `${relativePath}/${name}`.normalize("NFKC").toLowerCase();
    if (paths.has(identity)) {
      throw statusError(
        400,
        `The folder contains duplicate normalized path: ${relativePath}/${name}`,
      );
    }
    paths.add(identity);
    return {
      id: randomUUID(),
      name,
      relativePath,
      type: (file.type || "application/octet-stream").slice(0, 120),
      size: file.size,
      tempName: randomUUID(),
    };
  });
}

export class UploadService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly database: VeyraDatabase,
    private readonly storage: StorageManager,
  ) {}

  private async withFileLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.locks.set(key, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
  }

  private validateCapacity(
    files: ReturnType<typeof normalizeManifestFiles>,
    maximumFiles?: number,
    maximumSize?: number,
  ): number {
    const policy = loadCapacityPolicy(this.database);
    const fileLimit = Math.min(
      policy.maxFilesPerShare,
      maximumFiles ?? policy.maxFilesPerShare,
    );
    if (files.length > fileLimit) {
      throw statusError(413, `A maximum of ${fileLimit} files is allowed.`);
    }
    for (const file of files) {
      if (file.size > config.VEYRA_MAX_FILE_SIZE) {
        throw statusError(413, `${file.name} exceeds the per-file limit.`);
      }
    }
    const expectedSize = files.reduce((total, file) => total + file.size, 0);
    const shareLimit = Math.min(
      policy.maxShareBytes,
      maximumSize ?? policy.maxShareBytes,
    );
    if (expectedSize > shareLimit) {
      throw statusError(413, "This upload exceeds the per-share size limit.");
    }
    return expectedSize;
  }

  private async guardFreeSpace(expectedSize: number): Promise<void> {
    const policy = loadCapacityPolicy(this.database);
    const available = await this.storage.local.availableBytes();
    if (available - expectedSize < policy.minimumFreeBytes) {
      throw statusError(
        507,
        "The server is preserving its configured free-space reserve.",
        "FREE_SPACE_RESERVE",
      );
    }
  }

  private async createTemporaryFiles(
    files: ReturnType<typeof normalizeManifestFiles>,
  ): Promise<void> {
    const created: string[] = [];
    try {
      for (const file of files) {
        await this.storage.local.createTemporary(file.tempName);
        created.push(file.tempName);
      }
    } catch (error) {
      await Promise.all(
        created.map((name) => this.storage.local.removeTemporary(name)),
      );
      throw error;
    }
  }

  private sessionFiles(
    sessionId: string,
    files: ReturnType<typeof normalizeManifestFiles>,
    now: number,
  ): UploadFileRecord[] {
    return files.map((file, position) => ({
      id: file.id,
      upload_id: sessionId,
      position,
      original_name: file.name,
      relative_path: file.relativePath,
      mime_type: file.type,
      expected_size: file.size,
      received_size: 0,
      temp_name: file.tempName,
      created_at: now,
      updated_at: now,
    }));
  }

  private publicCreatedUpload(
    session: UploadSessionRecord,
    files: UploadFileRecord[],
    uploadToken?: string,
  ): CreatedUpload {
    return {
      id: session.id,
      expiresAt: new Date(session.expires_at).toISOString(),
      chunkSize: config.VEYRA_UPLOAD_CHUNK_SIZE,
      uploadToken,
      files: files.map((file) => ({
        id: file.id,
        name: file.original_name,
        relativePath: archivePath(file.relative_path, file.original_name),
        size: file.expected_size,
        offset: file.received_size,
      })),
    };
  }

  async createShareUpload(
    user: UserRecord,
    manifest: UploadManifest,
  ): Promise<CreatedUpload> {
    const files = normalizeManifestFiles(manifest.files);
    const expectedSize = this.validateCapacity(files);
    const password = manifest.options.password
      ? await hashPassword(manifest.options.password)
      : undefined;
    await this.guardFreeSpace(expectedSize);
    await this.createTemporaryFiles(files);

    const now = Date.now();
    const sessionId = randomUUID();
    const shareId = randomUUID();
    const publicToken = createPublicToken();
    const uploadFiles = this.sessionFiles(sessionId, files, now);
    const session: UploadSessionRecord = {
      id: sessionId,
      owner_id: user.id,
      share_id: shareId,
      submission_id: null,
      reverse_share_id: null,
      secret_hash: null,
      status: "uploading",
      storage_provider: null,
      expected_size: expectedSize,
      received_size: 0,
      file_count: files.length,
      options_json: JSON.stringify({
        recipientEmail: manifest.options.recipientEmail ?? null,
      }),
      error: null,
      effects_claimed_at: null,
      created_at: now,
      updated_at: now,
      expires_at:
        now + config.VEYRA_UPLOAD_SESSION_HOURS * 60 * 60 * 1_000,
    };
    const share: ShareRecord = {
      id: shareId,
      token_hash: hashToken(publicToken),
      token_encrypted: encryptValue(publicToken, config.secret),
      owner_id: user.id,
      created_at: now,
      expires_at:
        manifest.options.expiresInHours === null
          ? null
          : now + manifest.options.expiresInHours * 60 * 60 * 1_000,
      max_downloads: manifest.options.maxDownloads,
      download_count: 0,
      password_hash: password?.hash ?? null,
      password_salt: password?.salt ?? null,
      note: null,
      title: manifest.options.title?.trim() || null,
      description: manifest.options.description?.trim() || null,
      recipient_email: manifest.options.recipientEmail?.toLowerCase() ?? null,
      status: "uploading",
      source: "outbound",
      reverse_share_id: null,
      sender_name: null,
      sender_email: null,
      total_size: 0,
    };

    try {
      this.database.createUploadSession(
        { session, share, files: uploadFiles },
        loadCapacityPolicy(this.database),
      );
    } catch (error) {
      await Promise.all(
        files.map((file) =>
          this.storage.local.removeTemporary(file.tempName),
        ),
      );
      throw error;
    }
    return this.publicCreatedUpload(session, uploadFiles);
  }

  async createReverseUpload(
    request: ReverseShareRecord,
    manifest: ReverseUploadManifest,
  ): Promise<CreatedUpload> {
    const files = normalizeManifestFiles(manifest.files);
    const expectedSize = this.validateCapacity(
      files,
      request.max_files,
      request.max_total_size,
    );
    await this.guardFreeSpace(expectedSize);
    await this.createTemporaryFiles(files);

    const now = Date.now();
    const sessionId = randomUUID();
    const submissionId = randomUUID();
    const uploadToken = createPublicToken();
    const uploadFiles = this.sessionFiles(sessionId, files, now);
    const session: UploadSessionRecord = {
      id: sessionId,
      owner_id: request.owner_id,
      share_id: null,
      submission_id: submissionId,
      reverse_share_id: request.id,
      secret_hash: hashToken(uploadToken),
      status: "uploading",
      storage_provider: null,
      expected_size: expectedSize,
      received_size: 0,
      file_count: files.length,
      options_json: "{}",
      error: null,
      effects_claimed_at: null,
      created_at: now,
      updated_at: now,
      expires_at:
        now + config.VEYRA_UPLOAD_SESSION_HOURS * 60 * 60 * 1_000,
    };
    try {
      this.database.createUploadSession(
        {
          session,
          submission: {
            id: submissionId,
            reverse_share_id: request.id,
            owner_id: request.owner_id,
            sender_name: manifest.senderName?.trim() || null,
            sender_email: manifest.senderEmail?.toLowerCase() ?? null,
            message: manifest.message?.trim() || null,
            status: "uploading",
            total_size: 0,
            file_count: files.length,
            created_at: now,
          },
          files: uploadFiles,
        },
        loadCapacityPolicy(this.database),
      );
    } catch (error) {
      await Promise.all(
        files.map((file) =>
          this.storage.local.removeTemporary(file.tempName),
        ),
      );
      throw error;
    }
    return this.publicCreatedUpload(session, uploadFiles, uploadToken);
  }

  status(session: UploadSessionRecord): CreatedUpload & {
    status: UploadSessionRecord["status"];
    error: string | null;
  } {
    return {
      ...this.publicCreatedUpload(
        session,
        this.database.listUploadFiles(session.id),
      ),
      status: session.status,
      error: session.error,
    };
  }

  async offset(session: UploadSessionRecord, fileId: string): Promise<number> {
    return this.withFileLock(`${session.id}:${fileId}`, async () => {
      const file = this.database.findUploadFile(session.id, fileId);
      if (!file) throw statusError(404, "Upload file not found.");
      const actualSize = await this.storage.local.temporarySize(file.temp_name);
      const reconciled = this.database.reconcileUploadFileSize(
        session.id,
        file.id,
        actualSize,
      );
      if (reconciled === undefined) {
        throw statusError(409, "The staged upload could not be reconciled.");
      }
      return reconciled;
    });
  }

  async append(
    session: UploadSessionRecord,
    fileId: string,
    offset: number,
    contentLength: number,
    stream: Readable,
  ): Promise<number> {
    return this.withFileLock(`${session.id}:${fileId}`, async () => {
      const currentSession = this.database.findUploadSession(session.id);
      if (
        !currentSession ||
        currentSession.status !== "uploading" ||
        currentSession.expires_at <= Date.now()
      ) {
        throw statusError(409, "This upload session is not writable.");
      }
      const file = this.database.findUploadFile(session.id, fileId);
      if (!file) throw statusError(404, "Upload file not found.");
      const actualSize = await this.storage.local.temporarySize(file.temp_name);
      const reconciledOffset =
        actualSize === file.received_size
          ? actualSize
          : this.database.reconcileUploadFileSize(
              session.id,
              file.id,
              actualSize,
            );
      if (reconciledOffset === undefined) {
        throw statusError(409, "The staged upload could not be reconciled.");
      }
      if (reconciledOffset !== offset) {
        throw Object.assign(
          statusError(409, `Resume from byte ${reconciledOffset}.`),
          { uploadOffset: reconciledOffset },
        );
      }
      const remaining = file.expected_size - reconciledOffset;
      if (
        contentLength < 0 ||
        contentLength > config.VEYRA_UPLOAD_CHUNK_SIZE ||
        contentLength > remaining
      ) {
        throw statusError(413, "The upload chunk has an invalid size.");
      }
      const policy = loadCapacityPolicy(this.database);
      const available = await this.storage.local.availableBytes();
      if (available - contentLength < policy.minimumFreeBytes) {
        throw statusError(
          507,
          "The server is preserving its configured free-space reserve.",
        );
      }

      const received = await this.storage.local.appendTemporary(
        file.temp_name,
        stream,
        reconciledOffset,
        Math.min(config.VEYRA_UPLOAD_CHUNK_SIZE, remaining),
      );
      if (received !== contentLength) {
        await this.storage.local.truncateTemporary(file.temp_name, offset);
        throw statusError(400, "The chunk length did not match Content-Length.");
      }
      const next = this.database.advanceUploadFile(
        session.id,
        file.id,
        reconciledOffset,
        received,
      );
      if (next === undefined) {
        await this.storage.local.truncateTemporary(file.temp_name, offset);
        throw statusError(409, "The upload offset changed. Retry this chunk.");
      }
      return next;
    });
  }

  async finalize(session: UploadSessionRecord): Promise<FinalizedUpload> {
    return this.withFileLock(`${session.id}:finalize`, async () => {
      const latest = this.database.findUploadSession(session.id);
      if (!latest) throw statusError(404, "Upload session not found.");
      if (latest.status === "completed") {
        for (const file of this.database.listUploadFiles(latest.id)) {
          await this.storage.local.removeTemporary(file.temp_name);
        }
        const share = latest.share_id
          ? this.database.findShareById(latest.share_id) ?? null
          : null;
        const completedFiles = share
          ? this.database.listFiles(share.id)
          : latest.submission_id
            ? this.database.listSubmissionFiles(
                latest.owner_id,
                latest.submission_id,
              )
            : [];
        return {
          kind: share ? "share" : "submission",
          share,
          publicToken:
            share?.token_encrypted
              ? null
              : null,
          submissionId: latest.submission_id,
          scanStatus: completedFiles.some((file) => file.scan_status === "clean")
            ? "clean"
            : "disabled",
          alreadyCompleted: true,
        };
      }
      const uploadFiles = this.database.listUploadFiles(latest.id);
      if (
        uploadFiles.some(
          (file) => file.received_size !== file.expected_size,
        )
      ) {
        throw statusError(409, "Upload every file before finalizing.");
      }
      const provider = latest.storage_provider ?? this.storage.currentProvider();
      if (!this.database.markUploadProcessing(latest.id, provider)) {
        throw statusError(409, "This upload is already being finalized.");
      }

      const scanner = loadAntivirusSettings(this.database);
      const inspections: Array<{
        upload: UploadFileRecord;
        size: number;
        sha256: string;
        scanStatus: "clean" | "disabled" | "infected" | "error";
        reason: string | null;
      }> = [];
      let quarantineReason: string | null = null;

      try {
        for (const file of uploadFiles) {
          const inspected = await this.storage.local.inspectTemporary(
            file.temp_name,
          );
          if (inspected.size !== file.expected_size) {
            throw new Error(`Stored size mismatch for ${file.original_name}.`);
          }
          try {
            const scan = await scanFile(
              this.storage.local.tempPath(file.temp_name),
              scanner,
            );
            if (scan.status === "infected") {
              quarantineReason = `Malware detected: ${scan.signature}`;
              inspections.push({
                upload: file,
                size: inspected.size,
                sha256: inspected.sha256,
                scanStatus: "infected",
                reason: scan.signature,
              });
            } else {
              inspections.push({
                upload: file,
                size: inspected.size,
                sha256: inspected.sha256,
                scanStatus: scan.status,
                reason: null,
              });
            }
          } catch (error) {
            if (!scanner.enabled) throw error;
            const message =
              error instanceof Error ? error.message : "Antivirus scan failed.";
            quarantineReason = `Antivirus unavailable: ${message}`;
            inspections.push({
              upload: file,
              size: inspected.size,
              sha256: inspected.sha256,
              scanStatus: "error",
              reason: message.slice(0, 240),
            });
          }
        }

        if (quarantineReason) {
          for (const inspected of inspections) {
            await this.storage.local.quarantineTemporary(
              inspected.upload.temp_name,
              inspected.upload.temp_name,
            );
          }
          const quarantined = this.recordsFor(
            latest,
            inspections,
            "quarantine",
          );
          this.database.quarantineUpload(
            latest.id,
            quarantined,
            quarantineReason,
          );
          throw statusError(
            422,
            "The upload was quarantined and was not published.",
            "UPLOAD_QUARANTINED",
          );
        }

        const committed: Array<{ provider: "local" | "s3"; key: string }> = [];
        try {
          for (const inspected of inspections) {
            const key = inspected.upload.id;
            const storedProvider = await this.storage.commitTemporary(
              inspected.upload.temp_name,
              key,
              inspected.upload.mime_type,
              inspected.size,
              provider,
            );
            committed.push({ provider: storedProvider, key });
          }
          const records = this.recordsFor(latest, inspections, provider, committed);
          this.database.completeUpload(latest.id, records);
        } catch (error) {
          for (const object of committed) {
            try {
              await this.storage.remove(object.provider, object.key);
            } catch {
              this.database.queueObjectDeletions([
                {
                  storage_provider: object.provider,
                  stored_name: object.key,
                },
              ]);
            }
          }
          throw error;
        }

        for (const file of uploadFiles) {
          await this.storage.local.removeTemporary(file.temp_name);
        }
        const share = latest.share_id
          ? this.database.findShareById(latest.share_id) ?? null
          : null;
        return {
          kind: share ? "share" : "submission",
          share,
          publicToken: null,
          submissionId: latest.submission_id,
          scanStatus: scanner.enabled ? "clean" : "disabled",
          alreadyCompleted: false,
        };
      } catch (error) {
        const candidate = error as { code?: string };
        if (candidate.code !== "UPLOAD_QUARANTINED") {
          this.database.failUpload(
            latest.id,
            error instanceof Error ? error.message : "Finalization failed.",
          );
        }
        throw error;
      }
    });
  }

  private recordsFor(
    session: UploadSessionRecord,
    inspections: Array<{
      upload: UploadFileRecord;
      size: number;
      sha256: string;
      scanStatus: "clean" | "disabled" | "infected" | "error";
      reason: string | null;
    }>,
    provider: "local" | "s3" | "quarantine",
    committed?: Array<{ provider: "local" | "s3"; key: string }>,
  ): Array<FileRecord | SubmissionFileRecord> {
    return inspections.map((inspected, index) => {
      const storedName =
        provider === "quarantine"
          ? inspected.upload.temp_name
          : committed?.[index]?.key ?? randomUUID();
      if (session.share_id) {
        return {
          id: randomUUID(),
          share_id: session.share_id,
          original_name: inspected.upload.original_name,
          stored_name: storedName,
          mime_type: inspected.upload.mime_type,
          size: inspected.size,
          sha256: inspected.sha256,
          relative_path: inspected.upload.relative_path,
          storage_provider: provider,
          scan_status: inspected.scanStatus,
          quarantine_reason: inspected.reason,
        } satisfies FileRecord;
      }
      return {
        id: randomUUID(),
        submission_id: session.submission_id!,
        original_name: inspected.upload.original_name,
        relative_path: inspected.upload.relative_path,
        stored_name: storedName,
        storage_provider: provider,
        mime_type: inspected.upload.mime_type,
        size: inspected.size,
        sha256: inspected.sha256,
        scan_status: inspected.scanStatus,
        quarantine_reason: inspected.reason,
      } satisfies SubmissionFileRecord;
    });
  }

  async cancel(session: UploadSessionRecord): Promise<void> {
    const tempNames = this.database.cancelUpload(session.id, session.owner_id);
    if (!tempNames) throw statusError(409, "This upload cannot be cancelled.");
    for (const name of tempNames) {
      await this.storage.local.removeTemporary(name);
    }
  }

  async purgeExpired(): Promise<number> {
    const names = this.database.purgeExpiredUploads();
    for (const name of names) {
      await this.storage.local.removeTemporary(name);
    }
    return names.length;
  }
}
