import { CheckCircle2, Pencil, PlugZap, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { useTranslation, type Language } from "../i18n";
import type { ThemePref } from "../hooks/useLocalPrefs";
import {
  runtimeApi,
  type HealthStatus,
  type ModelApiProtocol,
  type ModelConfig,
  type ModelConnectionTestResult,
  type ModelDetectionResult,
  type ModelOption,
  type RuntimeSettings,
} from "../runtimeApi";
import "./SettingsPage.css";

type ModelFormData = {
  provider: string;
  model_name: string;
  base_url: string;
  api_key: string;
  api_protocol: ModelApiProtocol;
  is_default: boolean;
};

type ProviderPreset = {
  name: string;
  baseUrl: string;
  defaultModel: string;
  apiProtocol: ModelApiProtocol;
};

type Props = {
  settings: RuntimeSettings | null;
  models: ModelConfig[];
  theme: ThemePref;
  onLanguageChange: (lang: Language) => Promise<void>;
  onThemeChange: (t: ThemePref) => Promise<void>;
  onSettingsSaved: () => void;
  onModelsChanged: () => void;
  health: HealthStatus | null;
  showToast: (msg: string) => void;
};

const PROVIDER_PRESETS: ProviderPreset[] = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "", apiProtocol: "openai_chat" },
  { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-haiku-latest", apiProtocol: "anthropic_messages" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", apiProtocol: "openai_chat" },
  { name: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", defaultModel: "moonshot-v1-8k", apiProtocol: "openai_chat" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "", apiProtocol: "openai_chat" },
  { name: "Qwen DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus", apiProtocol: "openai_chat" },
  { name: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go/v1", defaultModel: "deepseek-v4-flash", apiProtocol: "openai_chat" },
];
const PROVIDER_OPTIONS = PROVIDER_PRESETS.map((preset) => preset.name);
const CUSTOM_PROVIDER_OPTION = "Custom";
const DEFAULT_MODEL_HOST_PERMISSION_PATTERNS = new Set([
  "https://api.openai.com/*",
  "https://api.anthropic.com/*",
  "https://api.deepseek.com/*",
  "https://api.moonshot.cn/*",
]);

export function SettingsPage({
  settings,
  models,
  theme,
  onLanguageChange,
  onThemeChange,
  onSettingsSaved,
  onModelsChanged,
  health,
  showToast,
}: Props) {
  const { t, language, setLanguage } = useTranslation();
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tryoutRounds, setTryoutRounds] = useState(String(settings?.skill_tryout_rounds ?? 3));
  const [savingTryoutRounds, setSavingTryoutRounds] = useState(false);
  const [testingModelId, setTestingModelId] = useState<number | null>(null);
  const [modelTestStatuses, setModelTestStatuses] = useState<Record<number, string>>({});

  useEffect(() => { setTryoutRounds(String(settings?.skill_tryout_rounds ?? 3)); }, [settings?.skill_tryout_rounds]);

  const handleLanguageChange = async (next: Language) => {
    setLanguage(next);
    try {
      await onLanguageChange(next);
      onSettingsSaved();
      showToast(t("toast.saved"));
    } catch {
      showToast(t("toast.saveFailed"));
    }
  };

  const handleThemeChange = async (next: ThemePref) => {
    try {
      await onThemeChange(next);
      onSettingsSaved();
      showToast(t("toast.saved"));
    } catch {
      showToast(t("toast.saveFailed"));
    }
  };

  const handleSaveTryoutRounds = async () => {
    const next = Math.max(3, Math.min(10, Math.round(Number(tryoutRounds) || 3)));
    setSavingTryoutRounds(true);
    try {
      const saved = await runtimeApi.saveSettings({ skill_tryout_rounds: next });
      setTryoutRounds(String(saved.skill_tryout_rounds ?? next));
      onSettingsSaved();
      showToast(t("toast.saved"));
    } catch {
      showToast(t("toast.saveFailed"));
    } finally {
      setSavingTryoutRounds(false);
    }
  };

  const openAddModal = () => { setEditing(null); setShowModal(true); };
  const openEditModal = (model: ModelConfig) => { setEditing(model); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditing(null); };

  const handleDelete = async (id: number) => {
    if (!confirm(t("common.delete") + "?")) return;
    try {
      await runtimeApi.deleteModel(id);
      onModelsChanged();
      showToast(t("toast.deleted"));
    } catch {
      showToast(t("toast.deleteFailed"));
    }
  };

  const handleSubmit = async (data: ModelFormData) => {
    setSaving(true);
    try {
      if (editing) {
        await runtimeApi.updateModel(editing.id, data);
      } else {
        await runtimeApi.createModel(data);
      }
      onModelsChanged();
      closeModal();
      showToast(t("toast.saved"));
    } catch {
      showToast(t("toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const isOnline = health?.ok ?? false;

  const handleTestSavedModel = async (model: ModelConfig) => {
    setTestingModelId(model.id);
    try {
      const hostPermissionGranted = await requestOptionalModelHostPermission(model.base_url);
      if (!hostPermissionGranted) {
        setModelTestStatuses((current) => ({ ...current, [model.id]: t("settings.hostPermissionDenied") }));
        return;
      }
      const result = await runtimeApi.testModel({ id: model.id });
      const message = modelConnectionMessage(result, t);
      setModelTestStatuses((current) => ({ ...current, [model.id]: message }));
      showToast(message);
    } catch {
      const message = t("toast.connectionFailed");
      setModelTestStatuses((current) => ({ ...current, [model.id]: message }));
      showToast(message);
    } finally {
      setTestingModelId(null);
    }
  };

  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

      <section className="settings-section">
        <header className="settings-section__header">
          <div>
            <h3 className="settings-section__title">{t("settings.extensionStatus")}</h3>
            <p className="settings-section__subtitle">
              {isOnline
                ? `${t("status.ready")} · ${health?.service ?? ""} v${health?.version ?? ""}`
                : t("settings.extensionStatusOffline")}
            </p>
          </div>
        </header>
      </section>

      <section className="settings-section">
        <header className="settings-section__header">
          <h3 className="settings-section__title">{t("settings.preferences")}</h3>
        </header>

        <div className="settings-row">
          <div className="settings-row__label">{t("settings.language")}</div>
          <SegmentedControl<Language>
            value={language}
            onChange={handleLanguageChange}
            options={[
              { value: "zh", label: "中文" },
              { value: "en", label: "EN" },
            ]}
            ariaLabel={t("settings.language")}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row__label">{t("settings.theme")}</div>
          <SegmentedControl<ThemePref>
            value={theme}
            onChange={handleThemeChange}
            options={[
              { value: "system", label: t("settings.themeSystem") },
              { value: "light", label: t("settings.themeLight") },
              { value: "dark", label: t("settings.themeDark") },
            ]}
            ariaLabel={t("settings.theme")}
          />
        </div>

        <div className="settings-row settings-row--stackable">
          <label className="settings-row__label" htmlFor="skill-tryout-rounds">{t("settings.skillTryoutRounds")}</label>
          <div className="settings-row__control">
            <input
              id="skill-tryout-rounds"
              className="input-field settings-number-input"
              type="number"
              min={3}
              max={10}
              value={tryoutRounds}
              onChange={(e) => setTryoutRounds(e.target.value)}
              aria-label={t("settings.skillTryoutRounds")}
            />
            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={handleSaveTryoutRounds}
              disabled={savingTryoutRounds}
            >
              {t("settings.saveTryoutRounds")}
            </button>
            <p className="settings-row__hint">{t("settings.skillTryoutRoundsHint")}</p>
          </div>
        </div>

      </section>

      <section className="settings-section">
        <header className="settings-section__header">
          <div>
            <h3 className="settings-section__title">{t("settings.models")}</h3>
            <p className="settings-section__subtitle">{t("settings.modelsSubtitle")}</p>
          </div>
          <button className="btn-secondary btn-sm" type="button" onClick={openAddModal}>
            <Plus size={14} aria-hidden="true" /> {t("settings.addModel")}
          </button>
        </header>

        {models.length === 0 ? (
          <div className="empty-state">
            <span>{t("settings.noModels")}</span>
            <button className="btn-primary btn-sm" type="button" onClick={openAddModal}>
              <Plus size={14} aria-hidden="true" /> {t("settings.addModel")}
            </button>
          </div>
        ) : (
          <div className="model-table" role="table">
            <div className="model-table__head" role="rowgroup">
              <div role="row">
                <div role="columnheader">{t("settings.colProvider")}</div>
                <div role="columnheader">{t("settings.colModel")}</div>
                <div role="columnheader">{t("settings.colKey")}</div>
                <div role="columnheader" className="model-table__actions">{t("settings.colActions")}</div>
              </div>
            </div>
            <div className="model-table__body" role="rowgroup">
              {models.map((m) => (
                <div className="model-table__row" role="row" key={m.id}>
                  <div role="cell">
                    <span className="model-cell__provider">{m.provider}</span>
                    {m.is_default && <span className="chip chip--seal">{t("settings.default")}</span>}
                  </div>
                  <div role="cell">{m.model_name}</div>
                  <div role="cell" className="model-cell__key">{m.api_key_masked || t("settings.notSet")}</div>
                  <div role="cell" className="model-table__actions">
                    <button
                      className="btn-ghost btn-xs"
                      type="button"
                      onClick={() => handleTestSavedModel(m)}
                      disabled={testingModelId === m.id}
                    >
                      <PlugZap size={14} aria-hidden="true" /> {t("settings.testConnection")}
                    </button>
                    <button className="btn-ghost btn-xs" type="button" onClick={() => openEditModal(m)} aria-label={t("common.edit")}>
                      <Pencil size={14} aria-hidden="true" /> {t("common.edit")}
                    </button>
                    <button className="btn-ghost btn-xs btn-danger-text" type="button" onClick={() => handleDelete(m.id)} aria-label={t("common.delete")}>
                      <Trash2 size={14} aria-hidden="true" /> {t("common.delete")}
                    </button>
                    {modelTestStatuses[m.id] && <span className="model-test-status">{modelTestStatuses[m.id]}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <ModelConfigModal
        open={showModal}
        editing={editing}
        saving={saving}
        onClose={closeModal}
        onSubmit={handleSubmit}
      />
    </>
  );
}

function ModelConfigModal({
  open,
  editing,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing: ModelConfig | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: ModelFormData) => void;
}) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState("OpenAI");
  const [customProvider, setCustomProvider] = useState("");
  const [modelName, setModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [apiProtocol, setApiProtocol] = useState<ModelApiProtocol>("openai_chat");
  const [isDefault, setIsDefault] = useState(false);
  const [detectingModels, setDetectingModels] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [detectedModels, setDetectedModels] = useState<ModelOption[]>([]);
  const [detectStatus, setDetectStatus] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("");

  useEffect(() => {
    if (open) {
      const nextProvider = editing?.provider ?? "OpenAI";
      if (PROVIDER_OPTIONS.includes(nextProvider)) {
        setProvider(nextProvider);
        setCustomProvider("");
      } else {
        setProvider(CUSTOM_PROVIDER_OPTION);
        setCustomProvider(nextProvider);
      }
      setModelName(editing?.model_name ?? "");
      setBaseUrl(editing?.base_url ?? "https://api.openai.com/v1");
      setApiKey("");
      setApiProtocol(editing?.api_protocol ?? providerPreset(nextProvider)?.apiProtocol ?? "openai_chat");
      setIsDefault(editing?.is_default ?? false);
      setDetectedModels([]);
      setDetectStatus("");
      setConnectionStatus("");
    }
  }, [open, editing]);

  const handleProviderChange = (nextProvider: string) => {
    setProvider(nextProvider);
    if (nextProvider === CUSTOM_PROVIDER_OPTION) return;
    const preset = providerPreset(nextProvider);
    if (!preset) return;
    setCustomProvider("");
    setBaseUrl(preset.baseUrl);
    setApiProtocol(preset.apiProtocol);
    setModelName((current) => current.trim() ? current : preset.defaultModel);
  };

  const currentFormData = (): ModelFormData & { id?: number } => {
    const providerName = provider === CUSTOM_PROVIDER_OPTION ? customProvider : provider;
    return {
      id: editing?.id,
      provider: providerName.trim(),
      model_name: modelName.trim(),
      base_url: baseUrl.trim(),
      api_key: apiKey,
      api_protocol: apiProtocol,
      is_default: isDefault,
    };
  };

  const handleSubmit = () => {
    const data = currentFormData();
    if (!data.provider || !data.model_name || !data.base_url) return;
    onSubmit(data);
  };

  const handleDetectModels = async () => {
    const data = currentFormData();
    if (!data.base_url) return;
    setDetectingModels(true);
    setDetectStatus("");
    setDetectedModels([]);
    try {
      const hostPermissionGranted = await requestOptionalModelHostPermission(data.base_url);
      if (!hostPermissionGranted) {
        setDetectStatus(t("settings.hostPermissionDenied"));
        return;
      }
      const result = await runtimeApi.detectModels({
        base_url: data.base_url,
        api_key: data.api_key,
        api_protocol: data.api_protocol,
      });
      if (result.ok) {
        setDetectedModels(result.models);
        setDetectStatus(result.models.length > 0 ? t("settings.detectModelsSuccess") : t("settings.detectModelsEmpty"));
      } else {
        setDetectStatus(modelDetectionMessage(result, t));
      }
    } catch {
      setDetectStatus(t("settings.detectModelsFailed"));
    } finally {
      setDetectingModels(false);
    }
  };

  const handleTestConnection = async () => {
    const data = currentFormData();
    if (!data.base_url || !data.model_name) return;
    setTestingConnection(true);
    setConnectionStatus("");
    try {
      const hostPermissionGranted = await requestOptionalModelHostPermission(data.base_url);
      if (!hostPermissionGranted) {
        setConnectionStatus(t("settings.hostPermissionDenied"));
        return;
      }
      const result = await runtimeApi.testModel(data);
      setConnectionStatus(modelConnectionMessage(result, t));
    } catch {
      setConnectionStatus(t("toast.connectionFailed"));
    } finally {
      setTestingConnection(false);
    }
  };

  const chooseDetectedModel = (model: ModelOption) => {
    setModelName(model.id);
    setApiProtocol(model.api_protocol);
  };

  return (
    <Modal
      open={open}
      title={editing ? t("settings.editModel") : t("settings.configureModel")}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn-primary" type="button" onClick={handleSubmit} disabled={saving}>
            <Save size={14} aria-hidden="true" /> {t("common.confirm")}
          </button>
        </>
      }
    >
      <label className="field-label">
        <span className="field-label__title">{t("settings.provider")}</span>
        <select className="select-field" value={provider} onChange={(e) => handleProviderChange(e.target.value)}>
          {PROVIDER_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value={CUSTOM_PROVIDER_OPTION}>{t("settings.providerCustom")}</option>
        </select>
      </label>

      {provider === CUSTOM_PROVIDER_OPTION && (
        <label className="field-label">
          <span className="field-label__title">{t("settings.customProvider")}</span>
          <input
            className="input-field"
            value={customProvider}
            onChange={(e) => setCustomProvider(e.target.value)}
            placeholder="Qwen Bailian"
          />
        </label>
      )}

      <label className="field-label">
        <span className="field-label__title">{t("settings.modelName")}</span>
        <input
          className="input-field"
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          placeholder="gpt-4o-mini"
        />
      </label>

      <label className="field-label">
        <span className="field-label__title">{t("settings.baseUrl")}</span>
        <input
          className="input-field"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
        />
      </label>

      <label className="field-label">
        <span className="field-label__title">{t("settings.apiProtocol")}</span>
        <select
          className="select-field"
          value={apiProtocol}
          onChange={(e) => setApiProtocol(e.target.value as ModelApiProtocol)}
          aria-label={t("settings.apiProtocol")}
        >
          <option value="openai_chat">{t("settings.protocolOpenAIChat")}</option>
          <option value="anthropic_messages">{t("settings.protocolAnthropicMessages")}</option>
        </select>
      </label>

      <label className="field-label">
        <span className="field-label__title">
          {t("settings.apiKey")}
          {editing && <span className="settings-hint">({t("settings.apiKeyHint")})</span>}
        </span>
        <input
          className="input-field"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
        />
      </label>

      <div className="model-config-tools">
        <button className="btn-secondary btn-sm" type="button" onClick={handleDetectModels} disabled={detectingModels}>
          <Search size={14} aria-hidden="true" /> {detectingModels ? t("settings.detectingModels") : t("settings.detectModels")}
        </button>
        <button className="btn-secondary btn-sm" type="button" onClick={handleTestConnection} disabled={testingConnection}>
          <PlugZap size={14} aria-hidden="true" /> {testingConnection ? t("settings.testingConnection") : t("settings.testConnection")}
        </button>
      </div>

      {(detectStatus || detectedModels.length > 0) && (
        <div className="model-detect-result">
          {detectStatus && (
            <p className="settings-row__hint settings-row__hint--inline">
              {detectStatus === t("settings.detectModelsSuccess") && <CheckCircle2 size={13} aria-hidden="true" />}
              {detectStatus}
            </p>
          )}
          {detectedModels.length > 0 && (
            <div className="model-detect-list" aria-label={t("settings.detectedModels")}>
              {detectedModels.slice(0, 24).map((model) => (
                <button
                  key={model.id}
                  className="model-detect-chip"
                  type="button"
                  onClick={() => chooseDetectedModel(model)}
                >
                  {model.id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {connectionStatus && (
        <p className="model-connection-status">
          <RefreshCw size={13} aria-hidden="true" /> {connectionStatus}
        </p>
      )}

      <label className="settings-default-toggle">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        <span>{t("settings.setDefault")}</span>
      </label>
    </Modal>
  );
}

function providerPreset(name: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.name === name);
}

function modelConnectionMessage(result: ModelConnectionTestResult, t: (key: string) => string): string {
  return result.ok ? t("toast.connectionSuccess") : readableModelError(result.error, t);
}

function modelDetectionMessage(result: ModelDetectionResult, t: (key: string) => string): string {
  return result.ok ? t("settings.detectModelsSuccess") : readableModelError(result.error, t);
}

function readableModelError(error: string, t: (key: string) => string): string {
  if (error === "model_api_key_missing") return t("settings.errorApiKeyMissing");
  if (error === "model_name_missing") return t("settings.errorModelMissing");
  if (error === "model_base_url_not_allowed") return t("settings.errorBaseUrlHttps");
  return error || t("toast.connectionFailed");
}

async function requestOptionalModelHostPermission(baseUrl: string): Promise<boolean> {
  const pattern = modelHostPermissionPattern(baseUrl);
  if (!pattern || DEFAULT_MODEL_HOST_PERMISSION_PATTERNS.has(pattern)) return true;

  const permissions = getChromePermissions();
  if (!permissions?.contains || !permissions.request) return true;

  try {
    if (await permissions.contains({ origins: [pattern] })) return true;
    return await permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

function modelHostPermissionPattern(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== "https:") return null;
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}

function getChromePermissions(): typeof chrome.permissions | null {
  try {
    if (typeof chrome !== "undefined" && chrome.permissions) return chrome.permissions;
  } catch {
    return null;
  }
  return null;
}
