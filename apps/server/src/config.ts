import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const schema = z.object({
  VEYRA_SECRET: z.string().min(32).optional(),
  VEYRA_SECRET_FILE: z.string().optional(),
  VEYRA_HOST: z.string().default("0.0.0.0"),
  VEYRA_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  VEYRA_BASE_URL: z.string().url().default("http://localhost:8080"),
  VEYRA_DATA_DIR: z.string().default("./data"),
  VEYRA_MAX_FILE_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024 * 1024),
  VEYRA_MAX_SHARE_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024 * 1024),
  VEYRA_DEFAULT_USER_QUOTA: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(100 * 1024 * 1024 * 1024),
  VEYRA_INSTANCE_QUOTA: z.coerce.number().int().nonnegative().default(0),
  VEYRA_MIN_FREE_BYTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(5 * 1024 * 1024 * 1024),
  VEYRA_MAX_FILES_PER_SHARE: z.coerce.number().int().min(1).max(2_000).default(500),
  VEYRA_UPLOAD_CHUNK_SIZE: z.coerce
    .number()
    .int()
    .min(1024 * 1024)
    .max(64 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  VEYRA_UPLOAD_SESSION_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(168)
    .default(24),
  VEYRA_TRUST_PROXY: booleanFromString,
  VEYRA_SECURE_COOKIES: booleanFromString,
  VEYRA_IP_SALT: z.string().min(16).optional(),
  VEYRA_IP_SALT_FILE: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const values = schema.parse(process.env);
const ephemeralSecret = randomBytes(48).toString("base64url");
const readSecret = (path: string | undefined): string | undefined => {
  if (!path) return undefined;
  const value = readFileSync(path, "utf8").trim();
  return value || undefined;
};
const configuredSecret =
  values.VEYRA_SECRET ?? readSecret(values.VEYRA_SECRET_FILE);
const configuredIpSalt =
  values.VEYRA_IP_SALT ?? readSecret(values.VEYRA_IP_SALT_FILE);

if (!configuredSecret && values.NODE_ENV === "production") {
  throw new Error(
    "VEYRA_SECRET or VEYRA_SECRET_FILE is required in production.",
  );
}

if (configuredSecret && configuredSecret.length < 32) {
  throw new Error("The configured Veyra secret must be at least 32 characters.");
}

if (configuredIpSalt && configuredIpSalt.length < 16) {
  throw new Error("The configured IP salt must be at least 16 characters.");
}

export const config = {
  ...values,
  dataDir: resolve(values.VEYRA_DATA_DIR),
  secret: configuredSecret ?? ephemeralSecret,
  ipSalt: configuredIpSalt ?? ephemeralSecret,
} as const;
