import { z } from "zod";
import { decryptValue, encryptValue } from "./auth.js";
import { config } from "./config.js";
import {
  type CapacityPolicy,
  VeyraDatabase,
} from "./database.js";
import type {
  S3StorageSettings,
  StorageSettings,
} from "./storage.js";

export const capacityPolicySchema = z.object({
  maxShareBytes: z.number().int().positive(),
  defaultUserQuotaBytes: z.number().int().positive().nullable(),
  instanceQuotaBytes: z.number().int().positive().nullable(),
  minimumFreeBytes: z.number().int().nonnegative(),
  maxFilesPerShare: z.number().int().min(1).max(2_000),
});

export const storageSettingsSchema = z.object({
  backend: z.enum(["local", "s3"]),
  endpoint: z.string().url().max(2_000).default("https://s3.amazonaws.com"),
  region: z.string().min(1).max(100).default("us-east-1"),
  bucket: z.string().min(3).max(255).default(""),
  prefix: z.string().max(500).default("veyra"),
  forcePathStyle: z.boolean().default(false),
  accessKeyId: z.string().max(512).default(""),
  secretAccessKey: z.string().max(2_048).default(""),
});

export const antivirusSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().min(1).max(253).default("clamav"),
  port: z.number().int().min(1).max(65_535).default(3310),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).default(300_000),
});

export const brandingSettingsSchema = z.object({
  name: z.string().min(1).max(40).default("Veyra"),
  tagline: z
    .string()
    .min(1)
    .max(120)
    .default("Private file sharing, beautifully self-hosted."),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#755cff"),
  logoVersion: z.number().int().nonnegative().default(0),
});

export const oidcSettingsSchema = z.object({
  enabled: z.boolean(),
  label: z.string().min(1).max(60).default("Single sign-on"),
  issuer: z.string().url().max(2_000).default("https://example.com"),
  clientId: z.string().max(1_000).default(""),
  clientSecret: z.string().max(4_096).default(""),
  allowRegistration: z.boolean().default(false),
});

interface StoredS3Settings
  extends Omit<S3StorageSettings, "secretAccessKey"> {
  secretAccessKeyEncrypted: string;
}

interface StoredOidcSettings
  extends Omit<z.infer<typeof oidcSettingsSchema>, "clientSecret"> {
  clientSecretEncrypted: string;
}

function parseJson<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function defaultCapacityPolicy(): CapacityPolicy {
  return {
    maxShareBytes: config.VEYRA_MAX_SHARE_SIZE,
    defaultUserQuotaBytes:
      config.VEYRA_DEFAULT_USER_QUOTA === 0
        ? null
        : config.VEYRA_DEFAULT_USER_QUOTA,
    instanceQuotaBytes:
      config.VEYRA_INSTANCE_QUOTA === 0 ? null : config.VEYRA_INSTANCE_QUOTA,
    minimumFreeBytes: config.VEYRA_MIN_FREE_BYTES,
    maxFilesPerShare: config.VEYRA_MAX_FILES_PER_SHARE,
  };
}

export function loadCapacityPolicy(database: VeyraDatabase): CapacityPolicy {
  const parsed = capacityPolicySchema.safeParse(
    parseJson(database.getSetting("capacity.policy")),
  );
  return parsed.success ? parsed.data : defaultCapacityPolicy();
}

export function saveCapacityPolicy(
  database: VeyraDatabase,
  policy: CapacityPolicy,
): void {
  database.setSetting("capacity.policy", JSON.stringify(policy));
}

export function loadStorageSettings(
  database: VeyraDatabase,
): StorageSettings {
  const backend = database.getSetting("storage.backend") === "s3" ? "s3" : "local";
  const stored = parseJson<StoredS3Settings>(
    database.getSetting("storage.s3"),
  );
  if (!stored) return { backend };
  return {
    backend,
    s3: {
      endpoint: stored.endpoint,
      region: stored.region,
      bucket: stored.bucket,
      prefix: stored.prefix,
      forcePathStyle: stored.forcePathStyle,
      accessKeyId: stored.accessKeyId,
      secretAccessKey: decryptValue(
        stored.secretAccessKeyEncrypted,
        config.secret,
      ),
    },
  };
}

export function storageSettingsForAdmin(database: VeyraDatabase) {
  const settings = loadStorageSettings(database);
  if (!settings.s3) {
    return {
      backend: settings.backend,
      endpoint: "https://s3.amazonaws.com",
      region: "us-east-1",
      bucket: "",
      prefix: "veyra",
      forcePathStyle: false,
      accessKeyId: "",
      secretConfigured: false,
    };
  }
  return {
    backend: settings.backend,
    endpoint: settings.s3.endpoint,
    region: settings.s3.region,
    bucket: settings.s3.bucket,
    prefix: settings.s3.prefix,
    forcePathStyle: settings.s3.forcePathStyle,
    accessKeyId: settings.s3.accessKeyId,
    secretConfigured: Boolean(settings.s3.secretAccessKey),
  };
}

export function saveStorageSettings(
  database: VeyraDatabase,
  input: z.infer<typeof storageSettingsSchema>,
): void {
  if (input.backend === "local") {
    database.setSetting("storage.backend", "local");
    return;
  }
  const previous = loadStorageSettings(database);
  const secret =
    input.secretAccessKey ||
    previous.s3?.secretAccessKey ||
    "";
  if (!input.bucket || !input.accessKeyId || !secret) {
    throw Object.assign(new Error("Complete the S3 bucket and credentials."), {
      statusCode: 400,
    });
  }
  const stored: StoredS3Settings = {
    endpoint: input.endpoint,
    region: input.region,
    bucket: input.bucket,
    prefix: input.prefix,
    forcePathStyle: input.forcePathStyle,
    accessKeyId: input.accessKeyId,
    secretAccessKeyEncrypted: encryptValue(secret, config.secret),
  };
  database.setSetting("storage.s3", JSON.stringify(stored));
  database.setSetting("storage.backend", "s3");
}

export function loadAntivirusSettings(database: VeyraDatabase) {
  const parsed = antivirusSettingsSchema.safeParse(
    parseJson(database.getSetting("security.antivirus")),
  );
  return parsed.success
    ? parsed.data
    : {
        enabled: false,
        host: "clamav",
        port: 3310,
        timeoutMs: 300_000,
      };
}

export function saveAntivirusSettings(
  database: VeyraDatabase,
  value: z.infer<typeof antivirusSettingsSchema>,
): void {
  database.setSetting("security.antivirus", JSON.stringify(value));
}

export function loadBrandingSettings(database: VeyraDatabase) {
  const parsed = brandingSettingsSchema.safeParse(
    parseJson(database.getSetting("branding.public")),
  );
  return parsed.success ? parsed.data : brandingSettingsSchema.parse({});
}

export function saveBrandingSettings(
  database: VeyraDatabase,
  value: z.infer<typeof brandingSettingsSchema>,
): void {
  database.setSetting("branding.public", JSON.stringify(value));
}

export function loadOidcSettings(database: VeyraDatabase) {
  const stored = parseJson<StoredOidcSettings>(
    database.getSetting("auth.oidc"),
  );
  if (!stored) {
    return oidcSettingsSchema.parse({
      enabled: false,
      issuer: "https://example.com",
    });
  }
  return {
    enabled: stored.enabled,
    label: stored.label,
    issuer: stored.issuer,
    clientId: stored.clientId,
    clientSecret: stored.clientSecretEncrypted
      ? decryptValue(stored.clientSecretEncrypted, config.secret)
      : "",
    allowRegistration: stored.allowRegistration,
  };
}

export function oidcSettingsForAdmin(database: VeyraDatabase) {
  const settings = loadOidcSettings(database);
  return {
    enabled: settings.enabled,
    label: settings.label,
    issuer: settings.issuer,
    clientId: settings.clientId,
    clientSecretConfigured: Boolean(settings.clientSecret),
    allowRegistration: settings.allowRegistration,
  };
}

export function saveOidcSettings(
  database: VeyraDatabase,
  input: z.infer<typeof oidcSettingsSchema>,
): void {
  const previous = loadOidcSettings(database);
  const secret = input.clientSecret || previous.clientSecret;
  if (input.enabled && (!input.clientId || !secret)) {
    throw Object.assign(new Error("Complete the OIDC client configuration."), {
      statusCode: 400,
    });
  }
  const stored: StoredOidcSettings = {
    enabled: input.enabled,
    label: input.label,
    issuer: input.issuer,
    clientId: input.clientId,
    clientSecretEncrypted: secret
      ? encryptValue(secret, config.secret)
      : "",
    allowRegistration: input.allowRegistration,
  };
  database.setSetting("auth.oidc", JSON.stringify(stored));
}
