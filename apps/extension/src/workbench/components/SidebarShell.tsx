import { Box, BookOpen, LibraryBig, Moon, Settings as SettingsIcon, Sun, Wrench, Zap } from "lucide-react";
import type { HealthStatus } from "../runtimeApi";
import { useTranslation } from "../i18n";

export type MainNavKey = "settings" | "corpus" | "creator" | "library";
export type SubNavKey = "skills" | "ammo";

const MAIN_NAV: Array<{ key: MainNavKey; labelKey: string; icon: typeof Box }> = [
  { key: "settings", labelKey: "nav.settings", icon: SettingsIcon },
  { key: "corpus", labelKey: "nav.corpus", icon: Box },
  { key: "creator", labelKey: "nav.creator", icon: Wrench },
  { key: "library", labelKey: "nav.library", icon: LibraryBig },
];

const SUB_NAV: Array<{ key: SubNavKey; labelKey: string; icon: typeof Box }> = [
  { key: "skills", labelKey: "nav.skills", icon: BookOpen },
  { key: "ammo", labelKey: "nav.ammo", icon: Zap },
];

type Theme = "light" | "dark";

type SidebarShellProps = {
  active: MainNavKey;
  activeSub?: SubNavKey;
  onNavigate: (key: MainNavKey, sub?: SubNavKey) => void;
  health: HealthStatus | null;
  theme: Theme;
  onToggleTheme: () => void;
};

export function SidebarShell({ active, activeSub, onNavigate, health, theme, onToggleTheme }: SidebarShellProps) {
  const { t } = useTranslation();

  const healthClass = health === null
    ? "sidebar__health"
    : health.ok
      ? "sidebar__health sidebar__health--ok"
      : "sidebar__health sidebar__health--down";

  const healthLabel = health === null
    ? t("sidebar.offlineHint")
    : health.ok
      ? `Extension · v${health.version}`
      : t("sidebar.offlineHint");

  const isHealthClickable = health === null || !health.ok;

  return (
    <aside className="sidebar" aria-label={t("sidebar.brand")}>
      <h1 className="sidebar__brand">{t("sidebar.brand")}</h1>

      <nav className="sidebar__nav" role="tablist" aria-label="modules">
        {MAIN_NAV.map((item) => {
          const Icon = item.icon;
          const selected = item.key === active;
          const showSub = item.key === "library" && active === "library";
          return (
            <div key={item.key}>
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                className={`sidebar__nav-item ${selected ? "sidebar__nav-item--active" : ""}`}
                onClick={() => {
                  if (item.key === "library") {
                    onNavigate("library", activeSub ?? "skills");
                  } else {
                    onNavigate(item.key);
                  }
                }}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{t(item.labelKey)}</span>
              </button>
              {showSub && (
                <div className="sidebar__subnav">
                  {SUB_NAV.map((sub) => {
                    const SubIcon = sub.icon;
                    const subSelected = activeSub === sub.key;
                    return (
                      <button
                        key={sub.key}
                        type="button"
                        role="tab"
                        aria-selected={subSelected}
                        className={`sidebar__subnav-item ${subSelected ? "sidebar__subnav-item--active" : ""}`}
                        onClick={() => onNavigate("library", sub.key)}
                      >
                        <SubIcon size={14} aria-hidden="true" />
                        <span>{t(sub.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <button
          type="button"
          className={healthClass}
          aria-live="polite"
          onClick={isHealthClickable ? () => onNavigate("settings") : undefined}
          disabled={!isHealthClickable}
        >
          <span className="sidebar__health-dot" aria-hidden="true" />
          <span>{healthLabel}</span>
        </button>
        <button
          type="button"
          className="sidebar__theme-toggle"
          onClick={onToggleTheme}
          aria-label={t("sidebar.toggleTheme")}
        >
          {theme === "light" ? <Moon size={14} aria-hidden="true" /> : <Sun size={14} aria-hidden="true" />}
          <span>{theme === "light" ? t("sidebar.themeDark") : t("sidebar.themeLight")}</span>
        </button>
      </div>
    </aside>
  );
}
