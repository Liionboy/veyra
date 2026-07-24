import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccessGrant,
  createPublicToken,
  hashPassword,
  hashToken,
  verifyAccessGrant,
  verifyPassword,
} from "./security.js";

test("public tokens are random and stored as one-way hashes", () => {
  const first = createPublicToken();
  const second = createPublicToken();
  assert.notEqual(first, second);
  assert.equal(first.length >= 40, true);
  assert.notEqual(hashToken(first), first);
});

test("password verification uses a salted memory-hard derivation", async () => {
  const password = "correct horse battery staple";
  const derived = await hashPassword(password);
  assert.equal(await verifyPassword(password, derived.salt, derived.hash), true);
  assert.equal(await verifyPassword("wrong password", derived.salt, derived.hash), false);
});

test("access grants are scoped and tamper evident", () => {
  const grant = createAccessGrant("share-a", "a-secret-that-is-long-enough-for-tests");
  assert.equal(
    verifyAccessGrant(grant, "share-a", "a-secret-that-is-long-enough-for-tests"),
    true,
  );
  assert.equal(
    verifyAccessGrant(grant, "share-b", "a-secret-that-is-long-enough-for-tests"),
    false,
  );
  assert.equal(
    verifyAccessGrant(`${grant}x`, "share-a", "a-secret-that-is-long-enough-for-tests"),
    false,
  );
});
