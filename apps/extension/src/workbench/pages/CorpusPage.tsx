import { ArrowLeft, Plus, ScanSearch, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Chip } from "../components/Chip";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { PaperCard } from "../components/PaperCard";
import { useTranslation } from "../i18n";
import { parseCorpusImportText, type CorpusImportEntry } from "../corpusImport";
import { runtimeApi, type CorpusBox, type CorpusEntry, type CrawlJob } from "../runtimeApi";
import "./CorpusPage.css";

type View =
  | { kind: "list" }
  | { kind: "detail"; boxId: number }
  | { kind: "crawl"; boxId: number }
  | { kind: "self-import"; boxId: number };

type Props = {
  boxes: CorpusBox[];
  onRefreshBoxes: () => void;
  onCreateSkillFromBox?: (boxId: number) => void;
  showToast: (msg: string) => void;
};

type ImportMethod = "self" | "crawl";

export function CorpusPage({ boxes, onRefreshBoxes, onCreateSkillFromBox, showToast }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ kind: "list" });
  const [showMethodModal, setShowMethodModal] = useState(false);
  const [pendingMethod, setPendingMethod] = useState<ImportMethod | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [creating, setCreating] = useState(false);

  const handlePickMethod = (method: ImportMethod) => {
    setPendingMethod(method);
    setShowMethodModal(false);
    setShowFormModal(true);
  };

  const handleCreateBox = async (data: { name: string; description: string }) => {
    if (!data.name.trim()) return;
    setCreating(true);
    try {
      const created = await runtimeApi.createBox(data.name.trim(), data.description.trim());
      onRefreshBoxes();
      setShowFormModal(false);
      const method = pendingMethod;
      setPendingMethod(null);
      showToast(t("toast.created"));
      if (method === "crawl") {
        setView({ kind: "crawl", boxId: created.id });
      } else {
        setView({ kind: "self-import", boxId: created.id });
      }
    } catch {
      showToast(t("toast.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  if (view.kind === "detail") {
    return (
      <CorpusDetail
        boxId={view.boxId}
        boxes={boxes}
        onBack={() => setView({ kind: "list" })}
        onCreateSkill={onCreateSkillFromBox}
        onDeleted={() => {
          onRefreshBoxes();
          setView({ kind: "list" });
        }}
        showToast={showToast}
      />
    );
  }

  if (view.kind === "crawl") {
    return (
      <CorpusCrawl
        boxId={view.boxId}
        boxes={boxes}
        onBack={() => setView({ kind: "list" })}
        onComplete={() => {
          onRefreshBoxes();
          setView({ kind: "detail", boxId: view.boxId });
        }}
        onContinueCrawl={() => setJoblessCrawlView(setView, view.boxId)}
        onCreateSkill={onCreateSkillFromBox}
        showToast={showToast}
      />
    );
  }

  if (view.kind === "self-import") {
    return (
      <CorpusSelfImport
        boxId={view.boxId}
        boxes={boxes}
        onBack={() => setView({ kind: "list" })}
        onComplete={() => {
          onRefreshBoxes();
          setView({ kind: "detail", boxId: view.boxId });
        }}
        showToast={showToast}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={t("corpus.title")}
        subtitle={t("corpus.subtitle")}
        actions={
          <button className="btn-primary" type="button" onClick={() => setShowMethodModal(true)}>
            <Plus size={14} aria-hidden="true" /> {t("corpus.new")}
          </button>
        }
      />

      {boxes.length === 0 ? (
        <div className="empty-state"><span>{t("corpus.empty")}</span></div>
      ) : (
        <div className="corpus-list">
          {boxes.map((box) => {
            const status = box.status ?? "ready";
            const entryCount = box.entry_count ?? 0;
            const platform = box.platform ?? "—";
            const updated = box.updated_at ? formatRelative(box.updated_at) : "";
            const meta = `${platform} · ${entryCount} · ${updated}`;
            return (
              <PaperCard
                key={box.id}
                title={box.name}
                meta={meta}
                onClick={() => setView({ kind: "detail", boxId: box.id })}
                rightSlot={
                  status === "ready" ? <Chip tone="healthy">{t("status.ready")}</Chip> :
                  status === "running" ? <Chip tone="running">{t("status.crawling")}</Chip> :
                  status === "failed" ? <Chip tone="seal">{t("status.failed")}</Chip> :
                  <Chip>{status}</Chip>
                }
              >
                {box.description && <p className="corpus-card__desc">{box.description}</p>}
              </PaperCard>
            );
          })}
        </div>
      )}

      <ImportMethodModal
        open={showMethodModal}
        onClose={() => setShowMethodModal(false)}
        onPick={handlePickMethod}
      />

      <CorpusFormModal
        open={showFormModal}
        method={pendingMethod}
        creating={creating}
        onClose={() => { setShowFormModal(false); setPendingMethod(null); }}
        onSubmit={handleCreateBox}
      />
    </>
  );
}

function setJoblessCrawlView(setView: (view: View) => void, boxId: number) {
  setView({ kind: "crawl", boxId });
}

function ImportMethodModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (method: ImportMethod) => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal open={open} title={t("corpus.importMethod")} onClose={onClose}>
      <div className="import-tabs">
        <button
          type="button"
          className="import-tabs__item"
          onClick={() => onPick("self")}
        >
          <Upload size={16} aria-hidden="true" />
          <div>
            <strong>{t("corpus.selfImport")}</strong>
            <span>{t("corpus.selfImportDesc")}</span>
          </div>
        </button>
        <button
          type="button"
          className="import-tabs__item"
          onClick={() => onPick("crawl")}
        >
          <Sparkles size={16} aria-hidden="true" />
          <div>
            <strong>{t("corpus.systemCrawl")}</strong>
            <span>{t("corpus.systemCrawlDesc")}</span>
          </div>
        </button>
      </div>
    </Modal>
  );
}

function CorpusFormModal({
  open,
  method,
  creating,
  onClose,
  onSubmit,
}: {
  open: boolean;
  method: ImportMethod | null;
  creating: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; description: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) { setName(""); setDescription(""); }
  }, [open]);

  const title = method === "crawl" ? t("corpus.systemCrawl") : t("corpus.selfImport");

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>{t("common.cancel")}</button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => onSubmit({ name, description })}
            disabled={!name.trim() || creating}
          >
            {t("common.next")}
          </button>
        </>
      }
    >
      <label className="field-label">
        <span className="field-label__title">{t("corpus.name")}</span>
        <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("corpus.nameHint")} />
      </label>
      <label className="field-label">
        <span className="field-label__title">{t("corpus.desc")}</span>
        <input className="input-field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("corpus.descHint")} />
      </label>
    </Modal>
  );
}

function CorpusDetail({
  boxId,
  boxes,
  onBack,
  onCreateSkill,
  onDeleted,
  showToast,
}: {
  boxId: number;
  boxes: CorpusBox[];
  onBack: () => void;
  onCreateSkill?: (boxId: number) => void;
  onDeleted: () => void;
  showToast: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CorpusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const box = boxes.find((b) => b.id === boxId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    runtimeApi.listEntries(boxId)
      .then((items) => { if (active) { setEntries(items); setLoading(false); } })
      .catch(() => { if (active) { setEntries([]); setLoading(false); } });
    return () => { active = false; };
  }, [boxId]);

  const handleDelete = async () => {
    if (!box) return;
    if (!confirm(t("corpus.deleteConfirm").replace("{name}", box.name))) return;
    try {
      await runtimeApi.deleteBox(boxId);
      showToast(t("toast.deleted"));
      onDeleted();
    } catch {
      showToast(t("toast.deleteFailed"));
    }
  };

  return (
    <>
      <button className="btn-ghost btn-sm corpus-back" type="button" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" /> {t("corpus.backToList")}
      </button>

      <PageHeader
        title={box?.name ?? t("corpus.title")}
        subtitle={box?.description}
        actions={
          <>
            <button className="btn-danger" type="button" onClick={handleDelete}>
              <Trash2 size={14} aria-hidden="true" /> {t("corpus.deleteBox")}
            </button>
            {onCreateSkill && (
              <button className="btn-primary" type="button" onClick={() => onCreateSkill(boxId)}>
                <Sparkles size={14} aria-hidden="true" /> {t("corpus.generateSkill")}
              </button>
            )}
          </>
        }
      />

      {loading ? (
        <div className="empty-state"><span>{t("common.loading")}</span></div>
      ) : entries.length === 0 ? (
        <div className="empty-state"><span>{t("corpus.noEntries")}</span></div>
      ) : (
        <div className="entry-list">
          {entries.map((entry) => (
            <article key={entry.id} className="entry-quote">
              <blockquote>{entry.content}</blockquote>
              <footer>{entry.source}</footer>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function CorpusCrawl({
  boxId,
  boxes,
  onBack,
  onComplete,
  onContinueCrawl,
  onCreateSkill,
  showToast,
}: {
  boxId: number;
  boxes: CorpusBox[];
  onBack: () => void;
  onComplete: () => void;
  onContinueCrawl: () => void;
  onCreateSkill?: (boxId: number) => void;
  showToast: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const box = boxes.find((b) => b.id === boxId);
  const [platform, setPlatform] = useState("zhihu");
  const [url, setUrl] = useState("");
  const [count, setCount] = useState(50);
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const timer = setInterval(async () => {
      try {
        const next = await runtimeApi.getCrawlJob(job.id);
        setJob(next);
        if (next.status !== "running") clearInterval(timer);
      } catch { /* ignore polling errors */ }
    }, 1500);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);

  const startCrawl = async () => {
    setError(null);
    if (!url.trim()) { setError(t("corpus.urlRequired")); return; }
    setStarting(true);
    try {
      const next = await runtimeApi.startCrawlJob({
        platform,
        mode: "creator",
        box_id: boxId,
        creator_url: url.trim(),
        requested_count: count,
      });
      setJob(next);
    } catch {
      setError(t("corpus.crawlFailed"));
      showToast(t("corpus.crawlFailed"));
    } finally {
      setStarting(false);
    }
  };

  const progressPct = job
    ? Math.min(100, Math.round((job.current_count / Math.max(1, job.requested_count)) * 100))
    : 0;

  const STATUS_LABEL: Record<CrawlJob["status"], string> = {
    running: t("status.running"),
    completed: t("status.completed"),
    blocked: t("status.blocked"),
    failed: t("status.failed"),
  };

  return (
    <>
      <button className="btn-ghost btn-sm corpus-back" type="button" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" /> {t("corpus.backToList")}
      </button>

      <PageHeader
        title={t("corpus.crawlTitle")}
        subtitle={box ? `${t("corpus.crawlTarget")}: ${box.name}` : undefined}
      />

      <div className="crawl-layout">
        <section className="crawl-form">
          <label className="field-label">
            <span className="field-label__title">{t("corpus.platform")}</span>
            <select className="select-field" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="zhihu">知乎</option>
              <option value="weibo">微博</option>
              <option value="xiaohongshu">小红书</option>
            </select>
          </label>

          <label className="field-label">
            <span className="field-label__title">{t("corpus.profileUrl")}</span>
            <input className="input-field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.zhihu.com/people/xxxx" />
          </label>

          <label className="field-label">
            <span className="field-label__title">{t("corpus.crawlCount")}</span>
            <input
              className="input-field"
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 0)}
            />
          </label>

          {error && <p className="crawl-error">{error}</p>}

          <button
            className="btn-primary"
            type="button"
            onClick={startCrawl}
            disabled={starting || Boolean(job && job.status === "running")}
          >
            <Sparkles size={14} aria-hidden="true" /> {t("corpus.startCrawl")}
          </button>
        </section>

        <aside className="crawl-progress">
          <h3 className="crawl-progress__title">{t("corpus.crawlProgress")}</h3>
          {!job ? (
            <CrawlEmptyGuide />
          ) : (
            <>
              <div className="crawl-progress__stat">
                <span className="crawl-progress__count">{job.current_count}</span>
                <span className="crawl-progress__total">/ {job.requested_count}</span>
                <Chip tone={job.status === "running" ? "running" : job.status === "completed" ? "healthy" : "seal"}>
                  {STATUS_LABEL[job.status]}
                </Chip>
              </div>
              <div className="crawl-progress__bar">
                <div className="crawl-progress__bar-fill" style={{ width: `${progressPct}%` }} />
              </div>
              {job.status === "completed" && (
                <div className="crawl-actions">
                  <button className="btn-secondary btn-sm" type="button" onClick={onComplete}>{t("corpus.viewEntries")}</button>
                  <button className="btn-secondary btn-sm" type="button" onClick={onContinueCrawl}>{t("corpus.continueCrawl")}</button>
                  {onCreateSkill && (
                    <button className="btn-primary btn-sm" type="button" onClick={() => onCreateSkill(boxId)}>{t("corpus.createSkillFromCrawl")}</button>
                  )}
                </div>
              )}
              <CrawlJobDetails job={job} />
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function CrawlEmptyGuide() {
  return (
    <section className="crawl-empty-guide" aria-label="创作者采风引导">
      <div className="crawl-empty-guide__head">
        <ScanSearch size={20} aria-hidden="true" />
        <div className="crawl-empty-guide__copy">
          <strong>尚未抓到内容：如何开始采风</strong>
          <span>来源页打开后，采风工具条只扫描当前已经加载出来的内容。</span>
        </div>
      </div>
      <div className="crawl-empty-guide__steps">
        <CrawlGuideStep number="1" title="打开来源平台创作者主页" body="知乎 / 微博 / 小红书的个人主页或作品列表页。" />
        <CrawlGuideStep number="2" title="滚动页面加载作品" body="采风只读取当前页面已经加载出来的内容。" />
        <CrawlGuideStep number="3" title="点击「扫描当前页」" body="新内容进入采风篮，重复内容自动跳过。" />
        <CrawlGuideStep number="4" title="确认导入素材箱" body="导入后回到素材箱里做完整清理。" />
      </div>
    </section>
  );
}

function CrawlGuideStep({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="crawl-empty-guide__step">
      <span className="crawl-empty-guide__number">{number}</span>
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
    </div>
  );
}

function CrawlJobDetails({ job }: { job: CrawlJob }) {
  const { t } = useTranslation();
  const sourceLabel = job.source_mode === "extension_page" ? t("corpus.sourceExtensionPage") : "";
  const imported = typeof job.imported === "number" ? job.imported : 0;
  const deduped = typeof job.deduped === "number" ? job.deduped : 0;

  return (
    <dl className="crawl-job-details">
      {(job.status === "blocked" || job.status === "failed") && (job.message || job.reason) && (
        <>
          <dt>{t("corpus.crawlReason")}</dt>
          <dd>{job.message || job.reason}</dd>
        </>
      )}
      {sourceLabel && (
        <>
          <dt>{t("corpus.platform")}</dt>
          <dd>{sourceLabel}</dd>
        </>
      )}
      {job.status !== "running" && (
        <>
          <dt>{t("corpus.crawlImported").replace("{count}", String(imported))}</dt>
          <dd>{t("corpus.crawlDeduped").replace("{count}", String(deduped))}</dd>
        </>
      )}
    </dl>
  );
}

function CorpusSelfImport({
  boxId,
  boxes,
  onBack,
  onComplete,
  showToast,
}: {
  boxId: number;
  boxes: CorpusBox[];
  onBack: () => void;
  onComplete: () => void;
  showToast: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const box = boxes.find((b) => b.id === boxId);
  const [fileEntries, setFileEntries] = useState<CorpusImportEntry[]>([]);
  const [fileNames, setFileNames] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [parsingFiles, setParsingFiles] = useState(false);
  const pastedEntries = parseCorpusImportText(pasteText, "pasted.txt");
  const entries = [...fileEntries, ...pastedEntries];

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    setError(null);
    if (files.length === 0) {
      setFileEntries([]);
      setFileNames("");
      return;
    }
    setParsingFiles(true);
    try {
      const parsed = await Promise.all(files.map(async (file) => parseCorpusImportText(await readFileText(file), file.name)));
      setFileEntries(parsed.flat());
      setFileNames(files.map((file) => file.name).join(", "));
    } catch {
      setFileEntries([]);
      setFileNames("");
      showToast(t("toast.saveFailed"));
    } finally {
      setParsingFiles(false);
    }
  };

  const handleImport = async () => {
    setError(null);
    if (entries.length === 0) {
      setError(t("corpus.importNoEntries"));
      return;
    }
    setImporting(true);
    try {
      const imported = await runtimeApi.addEntries(boxId, entries);
      showToast(t("corpus.importedCount").replace("{count}", String(imported.length)));
      onComplete();
    } catch {
      showToast(t("toast.saveFailed"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <button className="btn-ghost btn-sm corpus-back" type="button" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" /> {t("corpus.backToList")}
      </button>

      <PageHeader
        title={t("corpus.selfImport")}
        subtitle={box ? `${t("corpus.crawlTarget")}: ${box.name}` : undefined}
      />

      <section className="crawl-form">
        <label className="field-label">
          <span className="field-label__title">{t("corpus.importFile")}</span>
          <input
            className="input-field"
            type="file"
            accept=".jsonl,.json,.txt,.md,.markdown"
            multiple
            onChange={handleFileChange}
          />
          <span className="field-label__hint">{fileNames || t("corpus.importFileHint")}</span>
        </label>

        <label className="field-label">
          <span className="field-label__title">{t("corpus.pasteText")}</span>
          <textarea
            className="input-field corpus-paste-field"
            value={pasteText}
            onChange={(e) => { setPasteText(e.target.value); setError(null); }}
            placeholder={t("corpus.pastePlaceholder")}
          />
        </label>

        <p className="corpus-import-summary">
          {parsingFiles ? t("corpus.importParsing") : t("corpus.importReady").replace("{count}", String(entries.length))}
        </p>
        {error && <p className="crawl-error">{error}</p>}

        <button
          className="btn-primary"
          type="button"
          disabled={entries.length === 0 || importing || parsingFiles}
          onClick={handleImport}
        >
          <Upload size={14} aria-hidden="true" /> {importing ? t("corpus.importing") : t("common.confirm")}
        </button>
      </section>
    </>
  );
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(t).toLocaleDateString("zh-CN");
}

function readFileText(file: File): Promise<string> {
  if ("text" in file && typeof file.text === "function") return file.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("file_read_failed"));
    reader.readAsText(file);
  });
}
