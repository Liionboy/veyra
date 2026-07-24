import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const themeOptions = [
  {
    id: "system",
    name: "System",
    description: "Follows your device",
  },
  {
    id: "midnight",
    name: "Veyra Midnight",
    description: "Purple, cyan, and deep space",
  },
  {
    id: "polar",
    name: "Polar Light",
    description: "Bright, crisp, and calm",
  },
  {
    id: "ocean",
    name: "Deep Ocean",
    description: "Navy, cyan, and sea glass",
  },
  {
    id: "ember",
    name: "Ember",
    description: "Graphite with warm accents",
  },
  {
    id: "contrast",
    name: "High Contrast",
    description: "Maximum clarity and focus",
  },
] as const;

export type ThemePreference = (typeof themeOptions)[number]["id"];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

const themeStorageKey = "veyra.theme.v1";
const themeIds = new Set<ThemePreference>(themeOptions.map((theme) => theme.id));
const lightThemes = new Set<ResolvedTheme>(["polar"]);

const themeColors: Record<ResolvedTheme, string> = {
  midnight: "#080a0f",
  polar: "#f4f7fc",
  ocean: "#031018",
  ember: "#0d0908",
  contrast: "#000000",
};

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && themeIds.has(value as ThemePreference);
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "midnight" : "polar";
  return preference;
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

function applyTheme(preference: ThemePreference, resolvedTheme: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = preference;
  root.style.colorScheme = lightThemes.has(resolvedTheme) ? "light" : "dark";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themeColors[resolvedTheme]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(readStoredPreference);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const resolvedTheme = resolveTheme(preference, prefersDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    setPrefersDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyTheme(preference, resolvedTheme);
    try {
      window.localStorage.setItem(themeStorageKey, preference);
    } catch {
      // The theme still works when storage is unavailable.
    }
  }, [preference, resolvedTheme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== themeStorageKey) return;
      setPreferenceState(
        isThemePreference(event.newValue) ? event.newValue : "system",
      );
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      setPreference: setPreferenceState,
    }),
    [preference, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider.");
  return value;
}
