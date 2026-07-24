import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_KEY_LENGTH = 64;

export function createPublicToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(
  password: string,
): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return { hash: derived.toString("base64url"), salt };
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const actual = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(expectedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

interface GrantPayload {
  shareId: string;
  expiresAt: number;
}

export function createAccessGrant(
  shareId: string,
  secret: string,
  ttlSeconds = 15 * 60,
): string {
  const payload: GrantPayload = {
    shareId,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyAccessGrant(
  grant: string | undefined,
  shareId: string,
  secret: string,
): boolean {
  if (!grant) return false;
  const [encoded, providedSignature] = grant.split(".");
  if (!encoded || !providedSignature) return false;

  const expectedSignature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  const actualBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as GrantPayload;
    return (
      payload.shareId === shareId &&
      Number.isInteger(payload.expiresAt) &&
      payload.expiresAt >= Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

export function anonymizeIp(ip: string, salt: string): string {
  return createHmac("sha256", salt).update(ip).digest("hex");
}
