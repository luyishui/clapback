import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Chip } from "../components/Chip";
import { FilterPills } from "../components/SubNavPills";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { PaperCard } from "../components/PaperCard";
import { useTranslation } from "../i18n";
import { runtimeApi, type AmmoBoxSummary, type AmmoCategory, type AmmoEntry } from "../runtimeApi";
import "./AmmoBoxPage.css";

type View = { kind: "list" } | { kind: "detail"; ammoId: number };
type FilterValue = "all" | "meme" | "knowledge";

type Props = {
  ammoBoxes: AmmoBoxSummary[];
  onRefreshAmmo: () => void;
  showToast: (msg: string) => void;
};

export function AmmoBoxPage({ ammoBoxes, onRefreshAmmo, showToast }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ kind: "list" });
  const [filter, setFilter] = useState<FilterValue>("all");
  const [showCreateModal, setShowCreateModal] = useState(false);

  if (view.kind === "detail") {
    return (
      <AmmoDetailView
        ammoId={view.ammoId}
        ammoBoxes={ammoBoxes}
        onBack={() => setView({ kind: "list" })}
        onRefresh={onRefreshAmmo}
        showToast={showToast}
      />
    );
  }

  const filtered = ammoBoxes.filter((b) => filter === "all" ? true : b.category === filter);

  return (
    <>
      <PageHeader
        title={t("ammo.title")}
        subtitle={t("ammo.subtitle")}
        actions={
          <button className="btn-primary" type="button" onClick={() => setShowCreateModal(true)}>
            <Plus size={14} aria-hidden="true" /> {t("ammo.new")}
          </button>
        }
      />

      <FilterPills
        options={[
          { value: "all" as const, label: t("ammo.filterAll") },
          { value: "meme" as const, label: t("ammo.filterMeme") },
          { value: "knowledge" as const, label: t("ammo.filterKnowledge") },
        ]}
        value={filter}
        onChange={setFilter}
        ariaLabel={t("ammo.title")}
      />

      {filtered.length === 0 ? (
        <div className="empty-state">
          <span>{ammoBoxes.length === 0 ? t("ammo.empty") : t("ammo.emptyFilter")}</span>
        </div>
      ) : (
        <div className="ammo-grid">
          {filtered.map((box) => (
            <PaperCard
              key={box.id}
              title={box.name}
              meta={box.description}
              onClick={() => setView({ kind: "detail", ammoId: box.id })}
              rightSlot={<Chip tone="gold">{box.entry_count} {t("ammo.totalEntries").replace("{count} ", "").replace("共 ", "")}</Chip>}
            >
              <div className="ammo-card__chips">
                <Chip tone={box.status === "ready" ? "healthy" : "running"}>
                  {box.status === "ready" ? t("status.loaded") : t("common.loading")}
                </Chip>
                <Chip>{box.category === "meme" ? t("ammo.filterMeme") : t("ammo.filterKnowledge")}</Chip>
              </div>
            </PaperCard>
          ))}
        </div>
      )}

      <CreateAmmoModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={async (data) => {
          try {
            await runtimeApi.createAmmoBox(data);
            onRefreshAmmo();
            setShowCreateModal(false);
            showToast(t("toast.created"));
          } catch {
            showToast(t("toast.createFailed"));
          }
        }}
      />
    </>
  );
}

function CreateAmmoModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; category: AmmoCategory; description: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<AmmoCategory>("knowledge");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setCategory("knowledge");
      setDescription("");
    }
  }, [open]);

  return (
    <Modal
      open={open}
      title="新增弹药库"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>取消</button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => onSubmit({ name: name.trim(), category, description: description.trim() })}
            disabled={!name.trim()}
          >
            确定
          </button>
        </>
      }
    >
      <label className="field-label">
        <span className="field-label__title">名称</span>
        <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 法律常识弹药" />
      </label>

      <label className="field-label">
        <span className="field-label__title">类别</span>
        <select className="select-field" value={category} onChange={(e) => setCategory(e.target.value as AmmoCategory)}>
          <option value="knowledge">知识源库</option>
          <option value="meme">热门梗词</option>
        </select>
      </label>

      <label className="field-label">
        <span className="field-label__title">描述（可选）</span>
        <input className="input-field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明用途" />
      </label>
    </Modal>
  );
}

function AmmoDetailView({
  ammoId,
  ammoBoxes,
  onBack,
  onRefresh,
  showToast,
}: {
  ammoId: number;
  ammoBoxes: AmmoBoxSummary[];
  onBack: () => void;
  onRefresh: () => void;
  showToast: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AmmoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const box = ammoBoxes.find((b) => b.id === ammoId);

  const loadEntries = async () => {
    setLoading(true);
    try {
      setEntries(await runtimeApi.listAmmoEntries(ammoId));
    } catch { setEntries([]); }
    setLoading(false);
  };

  useEffect(() => { loadEntries(); }, [ammoId]);

  const handleDeleteBox = async () => {
    if (!confirm(t("ammo.deleteConfirm").replace("{name}", box?.name ?? ""))) return;
    try {
      await runtimeApi.deleteAmmoBox(ammoId);
      onRefresh();
      onBack();
      showToast(t("toast.deleted"));
    } catch {
      showToast(t("toast.deleteFailed"));
    }
  };

  const handleDeleteEntry = async (entryId: number) => {
    try {
      await runtimeApi.deleteAmmoEntry(ammoId, entryId);
      loadEntries();
      showToast(t("toast.deleted"));
    } catch {
      showToast(t("toast.deleteFailed"));
    }
  };

  return (
    <>
      <button className="btn-ghost btn-sm ammo-back" type="button" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" /> {t("ammo.backToList")}
      </button>

      <PageHeader
        title={box?.name ?? t("ammo.title")}
        subtitle={box?.description}
        actions={
          <>
            <button className="btn-secondary btn-sm" type="button" onClick={() => setShowAddEntry(true)}>
              <Plus size={14} aria-hidden="true" /> {t("ammo.addEntry")}
            </button>
            <button className="btn-danger btn-sm" type="button" onClick={handleDeleteBox}>
              <Trash2 size={14} aria-hidden="true" /> {t("ammo.deleteBox")}
            </button>
          </>
        }
      />

      <p className="ammo-stat">
        {t("ammo.totalEntries").replace("{count}", String(entries.length))}
        {box?.updated_at && ` · ${t("ammo.lastUpdated").replace("{time}", formatRelative(box.updated_at))}`}
      </p>

      {loading ? (
        <div className="empty-state"><span>{t("common.loading")}</span></div>
      ) : entries.length === 0 ? (
        <div className="empty-state"><span>{t("ammo.noEntries")}</span></div>
      ) : (
        <div className="ammo-entry-list">
          {entries.map((entry) => (
            <article key={entry.id} className="ammo-entry">
              <div>
                <h4 className="ammo-entry__term">{entry.term}</h4>
                <p className="ammo-entry__desc">{entry.description}</p>
              </div>
              <button className="btn-ghost btn-xs btn-danger-text" type="button" onClick={() => handleDeleteEntry(entry.id)} aria-label={t("common.delete")}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      )}

      <AddAmmoEntryModal
        open={showAddEntry}
        onClose={() => setShowAddEntry(false)}
        onSubmit={async (data) => {
          try {
            await runtimeApi.createAmmoEntry(ammoId, data);
            setShowAddEntry(false);
            loadEntries();
            showToast(t("toast.created"));
          } catch {
            showToast(t("toast.createFailed"));
          }
        }}
      />
    </>
  );
}

function AddAmmoEntryModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { term: string; description: string }) => Promise<void>;
}) {
  const [term, setTerm] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) { setTerm(""); setDescription(""); }
  }, [open]);

  return (
    <Modal
      open={open}
      title="新增条目"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>取消</button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => onSubmit({ term: term.trim(), description: description.trim() })}
            disabled={!term.trim()}
          >
            添加
          </button>
        </>
      }
    >
      <label className="field-label">
        <span className="field-label__title">术语 / 梗词</span>
        <input className="input-field" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="例如 典中典" />
      </label>

      <label className="field-label">
        <span className="field-label__title">解释</span>
        <textarea
          className="textarea-field"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="简短说明用法和语境"
        />
      </label>
    </Modal>
  );
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const day = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (day < 1) return "今天";
  if (day < 30) return `${day} 天前`;
  return new Date(t).toLocaleDateString("zh-CN");
}
