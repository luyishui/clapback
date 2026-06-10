import { ArrowLeft, Download, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { PaperCard } from "../components/PaperCard";
import { useTranslation } from "../i18n";
import { runtimeApi, type SkillDetail, type SkillInfo } from "../runtimeApi";
import { parseSkillPackageFile } from "../../api/skillPackages";
import "./SkillLibraryPage.css";

type View = { kind: "list" } | { kind: "detail"; skillId: string };

type Props = {
  skills: SkillInfo[];
  onSkillsChanged: () => void;
  showToast: (msg: string) => void;
};

export function SkillLibraryPage({ skills, onSkillsChanged, showToast }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ kind: "list" });
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const files = await parseSkillPackageFile(file);
      const result = await runtimeApi.compileSkill({ files });
      if (!result.ok) throw new Error(result.errors?.join("\n") || "skill_import_failed");
      onSkillsChanged();
      showToast(t("toast.created"));
    } catch {
      showToast(t("toast.createFailed"));
    }
    e.target.value = "";
  };

  if (view.kind === "detail") {
    return (
      <SkillDetailView
        skillId={view.skillId}
        skills={skills}
        onBack={() => setView({ kind: "list" })}
        onSkillsChanged={onSkillsChanged}
        showToast={showToast}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={t("skills.title")}
        subtitle={t("skills.subtitle")}
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.md"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <button className="btn-secondary" type="button" onClick={() => fileRef.current?.click()}>
              <Upload size={14} aria-hidden="true" /> {t("skills.import")}
            </button>
          </>
        }
      />

      {skills.length === 0 ? (
        <div className="empty-state"><span>{t("skills.empty")}</span></div>
      ) : (
        <div className="skill-grid">
          {skills.map((skill) => (
            <PaperCard
              key={skill.id}
              title={skill.name}
              onClick={() => setView({ kind: "detail", skillId: skill.id })}
            >
              <p className="skill-card__lineage">{skill.goal}</p>
            </PaperCard>
          ))}
        </div>
      )}
    </>
  );
}

function SkillDetailView({
  skillId,
  skills,
  onBack,
  onSkillsChanged,
  showToast,
}: {
  skillId: string;
  skills: SkillInfo[];
  onBack: () => void;
  onSkillsChanged: () => void;
  showToast: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const updateFileRef = useRef<HTMLInputElement>(null);
  const basic = skills.find((s) => s.id === skillId);
  const samples = detail?.sample_outputs ?? [];
  const files = detail?.files ?? {};
  const quality =
    detail?.manifest?.quality && typeof detail.manifest.quality === "object"
      ? detail.manifest.quality
      : null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    runtimeApi.getSkillDetail(skillId)
      .then((d) => {
        if (active) {
          setDetail(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setLoading(false);
          showToast(t("skills.detailFailed"));
        }
      });
    return () => {
      active = false;
    };
  }, [skillId]);

  const isBuiltin = detail?.compile_status === "builtin" || detail?.manifest?.builtin === true;

  const handleExport = () => {
    if (!detail) return;
    const { files: _files, manifest: _manifest, ...skill } = detail;
    const fallbackFiles = detail.files ?? (detail.skill_md ? { "SKILL.md": detail.skill_md } : {});
    const blob = new Blob([JSON.stringify({
      skill,
      manifest: detail.manifest ?? {},
      files: fallbackFiles,
      exported_at: new Date().toISOString(),
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${detail.id}.skill.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleUpdateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !detail || isBuiltin) return;
    try {
      const files = await parseSkillPackageFile(file);
      const result = await runtimeApi.compileSkill({ skillId: detail.id, files });
      if (!result.ok) throw new Error(result.errors?.join("\n") || "skill_update_failed");
      setDetail(await runtimeApi.getSkillDetail(detail.id));
      onSkillsChanged();
      showToast(t("toast.saved"));
    } catch {
      showToast(t("toast.saveFailed"));
    }
    e.target.value = "";
  };

  return (
    <>
      <button className="btn-ghost btn-sm skill-back" type="button" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" /> {t("skills.backToList")}
      </button>

      <PageHeader
        title={basic?.name ?? detail?.name ?? t("skills.title")}
        actions={
          detail ? (
            <>
              <button className="btn-secondary btn-sm" type="button" onClick={handleExport}>
                <Download size={14} aria-hidden="true" /> {t("skills.export")}
              </button>
              {!isBuiltin && (
                <>
                  <input
                    ref={updateFileRef}
                    type="file"
                    accept=".json,.md"
                    style={{ display: "none" }}
                    aria-label={t("skills.update")}
                    onChange={handleUpdateFile}
                  />
                  <button className="btn-primary btn-sm" type="button" onClick={() => updateFileRef.current?.click()}>
                    {t("skills.update")}
                  </button>
                </>
              )}
            </>
          ) : null
        }
      />

      {loading ? (
        <div className="empty-state"><span>{t("common.loading")}</span></div>
      ) : !detail ? (
        <div className="empty-state"><span>{t("skills.detailFailed")}</span></div>
      ) : (
        <>
          <div className="skill-detail__meta">
            <MetaRow label={t("skills.goal")} value={detail.goal ?? ""} />
            <MetaRow label={t("skills.version")} value={`v${detail.version ?? "1.0"}`} />
            <MetaRow label={t("skills.compileStatus")} value={detail.compile_status ?? "-"} />
            {detail.lineage && <MetaRow label={t("skills.source")} value={detail.lineage} />}
          </div>

          <section className="skill-detail__section">
            <h3>评分与风险</h3>
            <div className="skill-detail__risk">
              <p>{t("skills.score")}: {String(detail.score ?? "-")}</p>
              {detail.confidence && <p>{t("skills.confidence")}: {detail.confidence}</p>}
              {detail.recommended_default != null && (
                <p>默认推荐: {detail.recommended_default ? "是" : "否"}</p>
              )}
              {detail.risk_tips && detail.risk_tips.length > 0 ? (
                <ul>
                  {detail.risk_tips.map((tip, index) => <li key={index}>{tip}</li>)}
                </ul>
              ) : (
                <p>暂无风险提示</p>
              )}
              {quality && (
                <pre className="skill-detail__md">{JSON.stringify(quality, null, 2)}</pre>
              )}
            </div>
          </section>

          <section className="skill-detail__section">
            <h3>{t("skills.skillMdPreview")}</h3>
            <pre className="skill-detail__md">{detail.skill_md ?? ""}</pre>
          </section>

          {samples.length > 0 && (
            <section className="skill-detail__section">
              <h3>{t("skills.sampleOutputs")}</h3>
              <div className="skill-detail__samples">
                {samples.map((sample, index) => (
                  <div key={index} className="skill-sample">
                    <div className="skill-sample__prompt">{sample.prompt ?? sample.input}</div>
                    <div className="skill-sample__reply">{sample.reply ?? sample.output}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {files["style_profile.json"] != null && (
            <section className="skill-detail__section">
              <h3>style_profile.json</h3>
              <pre className="skill-detail__md">{files["style_profile.json"] ?? ""}</pre>
            </section>
          )}

          {files["attack_playbook.json"] != null && (
            <section className="skill-detail__section">
              <h3>attack_playbook.json</h3>
              <pre className="skill-detail__md">{files["attack_playbook.json"] ?? ""}</pre>
            </section>
          )}
        </>
      )}
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
