import { useEffect, useState, useCallback } from "react";
import type { Language } from "../i18n";
import { runtimeApi } from "../runtimeApi";

export type ThemePref = "light" | "dark" | "system";

function canUseBackgroundSettings(): boolean {
  const maybeChrome = globalThis.chrome as { runtime?: { sendMessage?: unknown } } | undefined;
  return typeof maybeChrome?.runtime?.sendMessage === "function";
}

function normalizeLanguage(value: unknown): Language | undefined {
  return value === "en" || value === "zh" ? value : undefined;
}

function normalizeTheme(value: unknown): ThemePref | undefined {
  return value === "light" || value === "dark" || value === "system" ? value : undefined;
}

async function loadPrefs(): Promise<Partial<Pick<LocalPrefs, "language" | "theme">>> {
  if (canUseBackgroundSettings()) {
    try {
      const settings = await runtimeApi.getSettings();
      return {
        language: normalizeLanguage(settings.language),
        theme: normalizeTheme(settings.theme),
      };
    } catch {
      // Fall through to local dev defaults when the extension runtime is unavailable.
    }
  }
  return {};
}

async function saveLanguagePref(language: Language): Promise<void> {
  if (canUseBackgroundSettings()) {
    await runtimeApi.saveSettings({ language });
  }
}

async function saveThemePref(theme: ThemePref): Promise<void> {
  if (canUseBackgroundSettings()) {
    await runtimeApi.saveSettings({ theme });
  }
}

export type LocalPrefs = {
  language: Language;
  theme: ThemePref;
  ready: boolean;
  setLanguage: (lang: Language) => Promise<void>;
  setTheme: (theme: ThemePref) => Promise<void>;
};

export function useLocalPrefs(): LocalPrefs {
  const [language, setLanguageState] = useState<Language>("zh");
  const [theme, setThemeState] = useState<ThemePref>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    loadPrefs().then(({ language: lang, theme: th }) => {
      if (!active) return;
      if (lang) setLanguageState(lang);
      if (th) setThemeState(th);
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang);
    await saveLanguagePref(lang);
  }, []);

  const setTheme = useCallback(async (th: ThemePref) => {
    setThemeState(th);
    await saveThemePref(th);
  }, []);

  return { language, theme, ready, setLanguage, setTheme };
}
