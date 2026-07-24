import assert from "node:assert/strict";
import test from "node:test";
import {
  isThemePreference,
  resolveTheme,
  type ThemePreference,
} from "../src/theme.js";

test("theme preferences reject unknown storage values", () => {
  assert.equal(isThemePreference("ocean"), true);
  assert.equal(isThemePreference("custom-css"), false);
  assert.equal(isThemePreference(null), false);
});

test("system preference follows the operating-system color scheme", () => {
  assert.equal(resolveTheme("system", true), "midnight");
  assert.equal(resolveTheme("system", false), "polar");
});

test("explicit themes are not changed by the operating system", () => {
  const explicitThemes: ThemePreference[] = [
    "midnight",
    "polar",
    "ocean",
    "ember",
    "contrast",
  ];
  for (const theme of explicitThemes) {
    assert.equal(resolveTheme(theme, true), theme);
    assert.equal(resolveTheme(theme, false), theme);
  }
});
