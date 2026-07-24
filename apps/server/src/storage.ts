import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  type ReadStream,
} from "node:fs";
import {
  copyFile,
  open,
  rename,
  stat,
  statfs,
  truncate,
  unlink,
} from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { Transform, Writable, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

export type StorageProviderName = "local" | "s3" | "quarantine";

export interface StoredFile {
  storedName: string;
  size: number;
  sha256: string;
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface OpenedObject {
  stream: Readable;
  size: number;
  range: ByteRange | null;
}

export interface S3StorageSettings {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface StorageSettings {
  backend: "local" | "s3";
  s3?: S3StorageSettings;
}

function normalizeObjectPrefix(value: string): string {
  return value
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function objectKey(prefix: string, key: string): string {
  const normalizedPrefix = normalizeObjectPrefix(prefix);
  return normalizedPrefix ? `${normalizedPrefix}/${key}` : key;
}

function bodyAsReadable(body: unknown): Readable {
  if (
    body &&
    typeof body === "object" &&
    "pipe" in body &&
    typeof (body as { pipe?: unknown }).pipe === "function"
  ) {
    return body as Readable;
  }
  throw new Error("The object store returned a non-streaming response.");
}

export class LocalStorage {
  readonly filesDir: string;
  readonly tempDir: string;
  readonly quarantineDir: string;

  constructor(dataDir: string) {
    this.filesDir = join(dataDir, "files");
    this.tempDir = join(dataDir, "tmp");
    this.quarantineDir = join(dataDir, "quarantine");
    mkdirSync(this.filesDir, { recursive: true, mode: 0o700 });
    mkdirSync(this.tempDir, { recursive: true, mode: 0o700 });
    mkdirSync(this.quarantineDir, { recursive: true, mode: 0o700 });
  }

  async store(stream: NodeJS.ReadableStream): Promise<StoredFile> {
    const storedName = randomUUID();
    const tempPath = this.tempPath(storedName);
    const finalPath = this.pathFor(storedName);
    const hash = createHash("sha256");
    let size = 0;

    const inspector = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        stream,
        inspector,
        createWriteStream(tempPath, { flags: "wx", mode: 0o600 }),
      );
      await rename(tempPath, finalPath);
      return { storedName, size, sha256: hash.digest("hex") };
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  pathFor(storedName: string): string {
    return join(this.filesDir, basename(storedName));
  }

  tempPath(tempName: string): string {
    return join(this.tempDir, `${basename(tempName)}.part`);
  }

  quarantinePath(storedName: string): string {
    return join(this.quarantineDir, basename(storedName));
  }

  async createTemporary(tempName: string): Promise<void> {
    const handle = await open(this.tempPath(tempName), "wx", 0o600);
    await handle.close();
  }

  async temporarySize(tempName: string): Promise<number> {
    return (await stat(this.tempPath(tempName))).size;
  }

  async appendTemporary(
    tempName: string,
    stream: NodeJS.ReadableStream,
    expectedOffset: number,
    maximumBytes: number,
  ): Promise<number> {
    const path = this.tempPath(tempName);
    const before = await stat(path);
    if (before.size !== expectedOffset) {
      throw Object.assign(
        new Error(`Upload offset mismatch. Expected ${before.size}.`),
        { statusCode: 409, uploadOffset: before.size },
      );
    }

    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > maximumBytes) {
          callback(
            Object.assign(new Error("The upload chunk is larger than allowed."), {
              statusCode: 413,
            }),
          );
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        stream,
        limiter,
        createWriteStream(path, {
          flags: "r+",
          start: expectedOffset,
          mode: 0o600,
        }),
      );
      return received;
    } catch (error) {
      await truncate(path, expectedOffset).catch(() => undefined);
      throw error;
    }
  }

  async inspectTemporary(tempName: string): Promise<StoredFile> {
    const path = this.tempPath(tempName);
    const hash = createHash("sha256");
    let size = 0;
    const inspector = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      createReadStream(path),
      inspector,
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
    return { storedName: tempName, size, sha256: hash.digest("hex") };
  }

  async commitTemporary(tempName: string, storedName: string): Promise<void> {
    await copyFile(this.tempPath(tempName), this.pathFor(storedName));
  }

  async quarantineTemporary(
    tempName: string,
    storedName: string,
  ): Promise<void> {
    await rename(this.tempPath(tempName), this.quarantinePath(storedName));
  }

  async removeTemporary(tempName: string): Promise<void> {
    await unlink(this.tempPath(tempName)).catch(() => undefined);
  }

  async truncateTemporary(tempName: string, size: number): Promise<void> {
    await truncate(this.tempPath(tempName), size);
  }

  async remove(storedName: string): Promise<void> {
    await unlink(this.pathFor(storedName)).catch(() => undefined);
  }

  async removeQuarantined(storedName: string): Promise<void> {
    await unlink(this.quarantinePath(storedName)).catch(() => undefined);
  }

  async open(
    storedName: string,
    range: ByteRange | null = null,
  ): Promise<OpenedObject> {
    const path = this.pathFor(storedName);
    const metadata = await stat(path);
    const normalizedRange = normalizeRange(range, metadata.size);
    const stream: ReadStream = normalizedRange
      ? createReadStream(path, {
          start: normalizedRange.start,
          end: normalizedRange.end,
        })
      : createReadStream(path);
    return {
      stream,
      size: metadata.size,
      range: normalizedRange,
    };
  }

  async availableBytes(): Promise<number> {
    const information = await statfs(this.filesDir);
    return Number(information.bavail) * Number(information.bsize);
  }

  async size(storedName: string): Promise<number> {
    return (await stat(this.pathFor(storedName))).size;
  }
}

class S3Storage {
  private readonly client: S3Client;

  constructor(private readonly settings: S3StorageSettings) {
    this.client = new S3Client({
      endpoint: settings.endpoint || undefined,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    });
  }

  async test(): Promise<void> {
    await this.client.send(
      new HeadBucketCommand({ Bucket: this.settings.bucket }),
    );
  }

  async putFromPath(
    sourcePath: string,
    key: string,
    mimeType: string,
    size: number,
  ): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.settings.bucket,
        Key: objectKey(this.settings.prefix, key),
        Body: createReadStream(sourcePath),
        ContentType: mimeType,
        ContentLength: size,
      },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    await upload.done();
  }

  async open(
    key: string,
    range: ByteRange | null = null,
  ): Promise<OpenedObject> {
    const normalizedKey = objectKey(this.settings.prefix, key);
    const metadata = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.settings.bucket,
        Key: normalizedKey,
      }),
    );
    const size = Number(metadata.ContentLength ?? 0);
    const normalizedRange = normalizeRange(range, size);
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.settings.bucket,
        Key: normalizedKey,
        Range: normalizedRange
          ? `bytes=${normalizedRange.start}-${normalizedRange.end}`
          : undefined,
      }),
    );
    return {
      stream: bodyAsReadable(result.Body),
      size,
      range: normalizedRange,
    };
  }

  async size(key: string): Promise<number> {
    const metadata = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.settings.bucket,
        Key: objectKey(this.settings.prefix, key),
      }),
    );
    return Number(metadata.ContentLength ?? 0);
  }

  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.settings.bucket,
        Key: objectKey(this.settings.prefix, key),
      }),
    );
  }

  async putProbe(key: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: objectKey(this.settings.prefix, key),
        Body: "",
      }),
    );
    await this.remove(key);
  }
}

export class StorageManager {
  readonly local: LocalStorage;

  constructor(
    dataDir: string,
    private readonly loadSettings: () => StorageSettings,
  ) {
    this.local = new LocalStorage(dataDir);
  }

  currentProvider(): "local" | "s3" {
    return this.loadSettings().backend;
  }

  async testS3(settings: S3StorageSettings): Promise<void> {
    const provider = new S3Storage(settings);
    await provider.test();
    await provider.putProbe(`.veyra-health-${randomUUID()}`);
  }

  async commitTemporary(
    tempName: string,
    storedName: string,
    mimeType: string,
    size: number,
    providerName = this.currentProvider(),
  ): Promise<"local" | "s3"> {
    if (providerName === "local") {
      await this.local.commitTemporary(tempName, storedName);
      return "local";
    }
    const settings = this.loadSettings();
    if (!settings.s3) {
      throw new Error("S3 storage is not configured.");
    }
    await new S3Storage(settings.s3).putFromPath(
      this.local.tempPath(tempName),
      storedName,
      mimeType,
      size,
    );
    return "s3";
  }

  async open(
    providerName: StorageProviderName,
    storedName: string,
    range: ByteRange | null = null,
  ): Promise<OpenedObject> {
    if (providerName === "quarantine") {
      throw Object.assign(new Error("Quarantined files cannot be opened."), {
        statusCode: 423,
      });
    }
    if (providerName === "local") {
      return this.local.open(storedName, range);
    }
    const settings = this.loadSettings();
    if (!settings.s3) throw new Error("S3 storage is not configured.");
    return new S3Storage(settings.s3).open(storedName, range);
  }

  async size(
    providerName: Exclude<StorageProviderName, "quarantine">,
    storedName: string,
  ): Promise<number> {
    if (providerName === "local") return this.local.size(storedName);
    const settings = this.loadSettings();
    if (!settings.s3) throw new Error("S3 storage is not configured.");
    return new S3Storage(settings.s3).size(storedName);
  }

  async remove(
    providerName: StorageProviderName,
    storedName: string,
  ): Promise<void> {
    if (providerName === "quarantine") {
      await this.local.removeQuarantined(storedName);
      return;
    }
    if (providerName === "local") {
      await this.local.remove(storedName);
      return;
    }
    const settings = this.loadSettings();
    if (!settings.s3) {
      throw new Error("S3 storage is not configured.");
    }
    await new S3Storage(settings.s3).remove(storedName);
  }
}

export function normalizeRange(
  range: ByteRange | null,
  size: number,
): ByteRange | null {
  if (!range) return null;
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.start >= size
  ) {
    throw Object.assign(new Error("The requested byte range is invalid."), {
      statusCode: 416,
    });
  }
  return { start: range.start, end: Math.min(range.end, size - 1) };
}

export function parseByteRange(
  header: string | undefined,
  size: number,
): ByteRange | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    throw Object.assign(new Error("Only one byte range is supported."), {
      statusCode: 416,
    });
  }
  if (!match[1] && !match[2]) {
    throw Object.assign(new Error("The requested byte range is invalid."), {
      statusCode: 416,
    });
  }
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw Object.assign(new Error("The requested byte range is invalid."), {
        statusCode: 416,
      });
    }
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  return normalizeRange({ start, end }, size);
}

export function safeDisplayName(filename: string | undefined): string {
  const normalized = (filename ?? "untitled")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim();
  return normalized.slice(0, 240) || "untitled";
}

export function safeRelativePath(value: string | undefined): string {
  if (!value) return "";
  const normalized = value
    .normalize("NFKC")
    .replace(/\\/g, "/")
    .replace(/[\u0000-\u001f\u007f]/g, "");
  const segments = normalized
    .split("/")
    .filter(Boolean)
    .filter((segment) => segment !== "." && segment !== "..")
    .map((segment) => safeDisplayName(segment));
  if (segments.length <= 1) return "";
  return posix.join(...segments.slice(0, -1)).slice(0, 1_000);
}

export function archivePath(relativePath: string, filename: string): string {
  const directory = relativePath
    ? safeRelativePath(`${relativePath}/placeholder`)
    : "";
  return directory
    ? posix.join(directory, safeDisplayName(filename))
    : safeDisplayName(filename);
}

export function contentDisposition(
  filename: string,
  disposition: "attachment" | "inline" = "attachment",
): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
