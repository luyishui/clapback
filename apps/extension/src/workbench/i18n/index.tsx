import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { runtimeApi } from "../runtimeApi";
import { zh } from "./zh";
import { en } from "./en";

export type Language = "zh" | "en";
export type TranslationDict = Record<string, string>;

const dictionaries: Record<Language, TranslationDict> = { zh, en };

type I18nContextValue = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue>({
  language: "zh",
  setLanguage: () => {},
  t: (key) => key,
});

function canUseBackgroundSettings(): boolean {
  const maybeChrome = globalThis.chrome as { runtime?: { sendMessage?: unknown } } | undefined;
  return typeof maybeChrome?.runtime?.sendMessage === "function";
}

type ProviderProps = {
  initialLanguage?: Language;
  children: ReactNode;
};

export function LanguageProvider({ initialLanguage = "zh", children }: ProviderProps) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  const t = useCallback((key: string): string => {
    return dictionaries[language][key] ?? dictionaries.zh[key] ?? key;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}

export async function loadSavedLanguage(): Promise<Language> {
  try {
    if (canUseBackgroundSettings()) {
      const saved = (await runtimeApi.getSettings()).language;
      if (saved === "en" || saved === "zh") return saved;
      return "zh";
    }
  } catch { /* */ }
  return "zh";
}
