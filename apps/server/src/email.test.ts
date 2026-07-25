import assert from "node:assert/strict";
import test from "node:test";
import { buildShareEmail } from "./email.js";

test("share email omits a password unless the sender explicitly supplies one", () => {
  const content = buildShareEmail({
    title: "Project files",
    description: null,
    url: "https://veyra.example/s/token",
    expiresAt: null,
  });

  assert.match(content.text, /supplied separately by the sender/);
  assert.match(content.html, /supplied separately by the sender/);
  assert.doesNotMatch(content.text, /Share password/);
  assert.doesNotMatch(content.html, /Share password/);
});

test("share email includes and HTML-escapes an explicitly supplied password", () => {
  const password = `Safe<&>"' passphrase`;
  const content = buildShareEmail({
    title: "Protected\r\nfiles",
    description: "Handle <carefully> & privately.",
    url: "https://veyra.example/s/token?next=<unsafe>",
    expiresAt: "2030-01-02T03:04:05.000Z",
    password,
  });

  assert.equal(content.subject, "Protected files · Veyra");
  assert.doesNotMatch(content.subject, new RegExp(password));
  assert.match(content.text, new RegExp(password));
  assert.match(content.text, /both the share link and its password/);
  assert.match(content.html, /Safe&lt;&amp;&gt;&quot;&#039; passphrase/);
  assert.doesNotMatch(content.html, /Safe<&>/);
  assert.match(content.html, /Handle &lt;carefully&gt; &amp; privately/);
  assert.match(content.html, /next=&lt;unsafe&gt;/);
});
