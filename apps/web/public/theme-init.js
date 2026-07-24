(() => {
  const storageKey = "veyra.theme.v1";
  const allowed = new Set([
    "system",
    "midnight",
    "polar",
    "ocean",
    "ember",
    "contrast",
  ]);
  const colors = {
    midnight: "#080a0f",
    polar: "#f4f7fc",
    ocean: "#031018",
    ember: "#0d0908",
    contrast: "#000000",
  };

  let preference = "system";
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (allowed.has(stored)) preference = stored;
  } catch {
    // Storage may be disabled; system mode remains available.
  }

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved =
    preference === "system" ? (prefersDark ? "midnight" : "polar") : preference;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved === "polar" ? "light" : "dark";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", colors[resolved]);
})();
