import { useCallback, useEffect, useRef, useState } from "react";
import { SidebarShell, type MainNavKey, type SubNavKey } from "./components/SidebarShell";
import { useRuntimeData } from "./hooks/useRuntimeData";
import { useLocalPrefs, type ThemePref } from "./hooks/useLocalPrefs";
import { LanguageProvider, useTranslation } from "./i18n";
import { AmmoBoxPage } from "./pages/AmmoBoxPage";
import { CorpusPage } from "./pages/CorpusPage";
import { CreatorPage } from "./pages/CreatorPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillLibraryPage } from "./pages/SkillLibraryPage";
import "./components/components.css";

type Route =
  | { page: "settings" }
  | { page: "corpus" }
  | { page: "creator"; boxIds?: number[] }
  | { page: "library"; tab: SubNavKey };

function applyTheme(pref: ThemePref) {
  const resolved =
    pref === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : pref;
  document.documentElement.dataset.theme = resolved;
}

function AppInner() {
  const prefs = useLocalPrefs();
  const { setLanguage, t } = useTranslation();
  const [route, setRoute] = useState<Route>({ page: "settings" });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const data = useRuntimeData();

  useEffect(() => {
    applyTheme(prefs.theme);
    if (prefs.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handle = () => applyTheme("system");
    mq.addEventListener("change", handle);
    return () => mq.removeEventListener("change", handle);
  }, [prefs.theme]);

  useEffect(() => {
    if (prefs.ready) setLanguage(prefs.language);
  }, [prefs.ready, prefs.language, setLanguage]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2800);
  }, []);

  const navigate = (key: MainNavKey, sub?: SubNavKey) => {
    if (key === "library") {
      setRoute({ page: "library", tab: sub ?? "skills" });
    } else {
      setRoute({ page: key });
    }
  };

  const activeMain: MainNavKey = route.page === "library" ? "library" : route.page as MainNavKey;
  const activeSub: SubNavKey = route.page === "library" ? route.tab : "skills";

  const toggleTheme = () => {
    const next: ThemePref = prefs.theme === "dark" ? "light" : "dark";
    void prefs.setTheme(next).catch(() => showToast(t("toast.saveFailed")));
  };

  return (
    <main className="workbench-shell paper-surface">
      <SidebarShell
        active={activeMain}
        activeSub={activeSub}
        onNavigate={navigate}
        health={data.health}
        theme={prefs.theme === "dark" ? "dark" : "light"}
        onToggleTheme={toggleTheme}
      />

      <section className="workbench-main" aria-live="polite">
        {route.page === "settings" && (
          <SettingsPage
            settings={data.settings}
            models={data.models}
            theme={prefs.theme}
            onLanguageChange={prefs.setLanguage}
            onThemeChange={prefs.setTheme}
            onSettingsSaved={data.refreshSettings}
            onModelsChanged={data.refreshModels}
            health={data.health}
            showToast={showToast}
          />
        )}

        {route.page === "corpus" && (
          <CorpusPage
            boxes={data.boxes}
            onRefreshBoxes={data.refreshBoxes}
            onCreateSkillFromBox={(boxId) => setRoute({ page: "creator", boxIds: [boxId] })}
            showToast={showToast}
          />
        )}

        {route.page === "creator" && (
          <CreatorPage
            boxes={data.boxes}
            skills={data.skills}
            initialBoxIds={route.boxIds}
            tryoutRounds={data.settings?.skill_tryout_rounds ?? 3}
            onSkillCreated={data.refreshSkills}
            showToast={showToast}
          />
        )}

        {route.page === "library" && route.tab === "skills" && (
          <SkillLibraryPage
            skills={data.skills}
            onSkillsChanged={data.refreshSkills}
            showToast={showToast}
          />
        )}

        {route.page === "library" && route.tab === "ammo" && (
          <AmmoBoxPage
            ammoBoxes={data.ammoBoxes}
            onRefreshAmmo={data.refreshAmmo}
            showToast={showToast}
          />
        )}
      </section>

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

export function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  );
}
