import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

export interface PublicConfig {
  name: string;
  tagline: string;
  accent: string;
  logoUrl: string | null;
  limits: {
    maxFileBytes: number;
    maxShareBytes: number;
    maxFilesPerShare: number;
    chunkBytes: number;
  };
  oidc: {
    enabled: boolean;
    label: string | null;
  };
  version: string;
}

const fallback: PublicConfig = {
  name: "Veyra",
  tagline: "Private file sharing, beautifully self-hosted.",
  accent: "#755cff",
  logoUrl: null,
  limits: {
    maxFileBytes: 10 * 1024 ** 3,
    maxShareBytes: 50 * 1024 ** 3,
    maxFilesPerShare: 500,
    chunkBytes: 8 * 1024 ** 2,
  },
  oidc: { enabled: false, label: null },
  version: "1.1.0",
};

const PublicConfigContext = createContext<PublicConfig>(fallback);

export function PublicConfigProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/public/config", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Public configuration unavailable.");
        return (await response.json()) as PublicConfig;
      })
      .then((config) => {
        setValue(config);
        const red = Number.parseInt(config.accent.slice(1, 3), 16);
        const green = Number.parseInt(config.accent.slice(3, 5), 16);
        const blue = Number.parseInt(config.accent.slice(5, 7), 16);
        document.documentElement.style.setProperty("--accent-primary", config.accent);
        document.documentElement.style.setProperty(
          "--accent-primary-rgb",
          `${red} ${green} ${blue}`,
        );
        document.documentElement.style.setProperty("--purple", config.accent);
        document.title = config.name;
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <PublicConfigContext.Provider value={value}>
      {children}
    </PublicConfigContext.Provider>
  );
}

export function usePublicConfig(): PublicConfig {
  return useContext(PublicConfigContext);
}
