import assert from "node:assert/strict";
import test from "node:test";
import {
  createLoginChallenge,
  createRecoveryCodes,
  decryptValue,
  encryptValue,
  hashRecoveryCode,
  normalizeRecoveryCode,
  totpCode,
  verifyLoginChallenge,
  verifyTotp,
} from "./auth.js";

const instanceSecret = "test-instance-secret-that-is-at-least-32-characters";

test("sensitive settings use authenticated encryption", () => {
  const encrypted = encryptValue("smtp-password", instanceSecret);
  assert.notEqual(encrypted, "smtp-password");
  assert.equal(decryptValue(encrypted, instanceSecret), "smtp-password");
  assert.throws(() => decryptValue(`${encrypted}x`, instanceSecret));
});

test("TOTP matches the RFC 6238 SHA-1 vector reduced to six digits", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totpCode(secret, 59_000), "287082");
  assert.equal(verifyTotp(secret, "287082", 59_000), true);
  assert.equal(verifyTotp(secret, "000000", 59_000), false);
});

test("recovery codes are high entropy, normalized, and one-way hashed", () => {
  const codes = createRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0]!, /^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/);
  assert.equal(normalizeRecoveryCode(codes[0]!), codes[0]!.replaceAll("-", ""));
  assert.notEqual(hashRecoveryCode(codes[0]!, instanceSecret), codes[0]);
});

test("two-factor login challenges are scoped and tamper evident", () => {
  const challenge = createLoginChallenge("user-1", instanceSecret);
  assert.equal(verifyLoginChallenge(challenge, instanceSecret)?.userId, "user-1");
  assert.equal(verifyLoginChallenge(`${challenge}x`, instanceSecret), undefined);
  assert.equal(
    verifyLoginChallenge(challenge, `${instanceSecret}-different`),
    undefined,
  );
});
