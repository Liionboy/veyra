import assert from "node:assert/strict";
import test from "node:test";
import { generateSharePassword } from "../src/share-password.js";

test("generated share passwords contain every character group", () => {
  let value = 0;
  const password = generateSharePassword(20, () => {
    value = (value + 17) % 256;
    return value;
  });

  assert.equal(password.length, 20);
  assert.match(password, /[a-z]/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[2-9]/);
  assert.match(password, /[!@#$%^&*]/);
  assert.doesNotMatch(password, /[01IlOo]/);
});

test("generated share passwords enforce the supported length range", () => {
  assert.throws(() => generateSharePassword(11, () => 0), RangeError);
  assert.throws(() => generateSharePassword(129, () => 0), RangeError);
  assert.equal(generateSharePassword(12, () => 0).length, 12);
  assert.equal(generateSharePassword(128, () => 0).length, 128);
});

test("generated share passwords reject invalid random bytes", () => {
  assert.throws(
    () => generateSharePassword(20, () => 256),
    /invalid value/,
  );
  assert.throws(
    () => generateSharePassword(20, () => 1.5),
    /invalid value/,
  );
});
