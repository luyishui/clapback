import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CUSTOM_LENGTH_DEFAULT_TARGET,
  CUSTOM_LENGTH_MAX_CHARS,
  CUSTOM_LENGTH_MODE,
  LENGTH_OPTIONS,
  sanitizeCustomLengthTarget,
} from "../../api/lengthConstraints";
import { PageHeader } from "../components/PageHeader";
import { useTranslation } from "../i18n";
import { runtimeApi, type CorpusBox, type SkillDraft, type SkillInfo } from "../runtimeApi";
import "./CreatorPage.css";

type Props = {
  boxes: CorpusBox[];
  skills: SkillInfo[];
  initialBoxIds?: number[];
  tryoutRounds: number;
  onSkillCreated: () => void;
  showToast: (msg: string) => void;
};

const FEEDBACK_TAGS = ["不够像", "不够狠", "太油", "逻辑弱", "太长", "太短", "梗太多", "梗太少"];
const CREATION_STAGE_KEYS = [
  "creator.stageValidateMaterial",
  "creator.stageReadMaterial",
  "creator.stageGenerateDraft",
  "creator.stageCompileCheck",
  "creator.stageEnterTryout",
] as const;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  degraded?: boolean;
  degradedReason?: string;
  pending?: boolean;
  failed?: boolean;
};

export function CreatorPage({ boxes, initialBoxIds, tryoutRounds, onSkillCreated, showToast }: Props) {
  const { t } = useTranslation();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [skillName, setSkillName] = useState("Clapback Skill");
  const [skillGoal, setSkillGoal] = useState("");
  const [selectedBoxes, setSelectedBoxes] = useState<Set<number>>(new Set(initialBoxIds ?? []));
  const [totalEntries, setTotalEntries] = useState(0);
  const [creating, setCreating] = useState(false);
  const [creationStageIndex, setCreationStageIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [acceptedTryoutIds, setAcceptedTryoutIds] = useState<number[]>([]);
  const [feedbackTags, setFeedbackTags] = useState<Set<string>>(new Set());
  const [feedbackText, setFeedbackText] = useState("");
  const [applyingFeedback, setApplyingFeedback] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [tryoutLengthMode, setTryoutLengthMode] = useState("短");
  const [customLengthTarget, setCustomLengthTarget] = useState(String(CUSTOM_LENGTH_DEFAULT_TARGET));
  const [creatorError, setCreatorError] = useState("");
  const sendingTryoutRef = useRef(false);

  useEffect(() => {
    if (initialBoxIds) setSelectedBoxes(new Set(initialBoxIds));
  }, [initialBoxIds?.join(",")]);

  useEffect(() => {
    let active = true;
    const ids = Array.from(selectedBoxes);
    if (ids.length === 0) { setTotalEntries(0); return; }
    Promise.all(ids.map((id) => runtimeApi.listEntries(id).then((e) => e.length).catch(() => 0)))
      .then((counts) => {
        if (!active) return;
        setTotalEntries(counts.reduce((a, b) => a + b, 0));
      });
    return () => { active = false; };
  }, [selectedBoxes]);

  const pendingTryout = chatMessages.some((msg) => msg.role === "assistant" && msg.pending);
  const completedRounds = chatMessages.filter((msg) => msg.role === "assistant" && !msg.pending && !msg.failed).length;
  const maxRounds = Math.max(3, Math.min(10, Math.round(tryoutRounds || 3)));
  const feedbackReady = Boolean(draft && completedRounds >= maxRounds);

  const handleSend = async () => {
    const text = chatInput.trim();
    if (!text || !draft || feedbackReady || pendingTryout || sendingTryoutRef.current) return;
    sendingTryoutRef.current = true;
    const roundIndex = completedRounds + 1;
    const pendingId = `tryout-pending-${roundIndex}-${Date.now()}`;
    setChatMessages((prev) => [
      ...prev,
      { id: `tryout-user-${roundIndex}-${Date.now()}`, role: "user", text },
      { id: pendingId, role: "assistant", text: t("creator.tryoutPending"), pending: true },
    ]);
    setChatInput("");
    setCreatorError("");
    try {
      const result = await runtimeApi.runSkillTryout(draft.id, {
        user_utterance: text,
        round_index: roundIndex,
        lengthMode: tryoutLengthMode,
        customLengthTarget: tryoutLengthMode === CUSTOM_LENGTH_MODE
          ? sanitizeCustomLengthTarget(customLengthTarget) ?? CUSTOM_LENGTH_DEFAULT_TARGET
          : undefined,
      });
      setChatMessages((prev) => prev.map((msg) => (
        msg.id === pendingId
          ? { ...msg, text: result.reply, degraded: result.degraded, degradedReason: result.degraded_reason, pending: false }
          : msg
      )));
      setAcceptedTryoutIds((prev) => [...prev, result.id]);
    } catch (error) {
      const message = skillCreatorErrorMessage(error, t, "creator.tryoutFailed");
      setChatMessages((prev) => prev.map((msg) => (
        msg.id === pendingId
          ? { ...msg, text: message, pending: false, failed: true }
          : msg
      )));
      showToast(message);
    } finally {
      sendingTryoutRef.current = false;
    }
  };

  const toggleBox = (id: number) => {
    setSelectedBoxes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (selectedBoxes.size === 0 || !skillGoal.trim()) return;
    setCreating(true);
    setCreationStageIndex(0);
    setCreatorError("");
    try {
      await Promise.resolve();
      setCreationStageIndex(1);
      await Promise.resolve();
      setCreationStageIndex(2);
      const next = await runtimeApi.createSkillDraft({
        source_box_ids: Array.from(selectedBoxes),
        skill_name: skillName.trim() || "Clapback Skill",
        skill_goal: skillGoal.trim(),
      });
      setCreationStageIndex(3);
      await Promise.resolve();
      setCreationStageIndex(4);
      setDraft(next);
      setChatMessages([]);
      setAcceptedTryoutIds([]);
      showToast(t("toast.created"));
    } catch (error) {
      const message = skillCreatorErrorMessage(error, t, "toast.createFailed");
      setCreatorError(message);
      showToast(message);
    } finally {
      setCreating(false);
    }
  };

  const toggleFeedbackTag = (tag: string) => {
    setFeedbackTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const handleFeedback = async () => {
    if (!draft) return;
    setApplyingFeedback(true);
    setCreatorError("");
    try {
      const next = await runtimeApi.sendSkillFeedback(draft.id, {
        tags: Array.from(feedbackTags),
        feedback: feedbackText.trim(),
      });
      setDraft(next);
      setChatMessages([]);
      setAcceptedTryoutIds([]);
      setFeedbackTags(new Set());
      setFeedbackText("");
      showToast(t("toast.saved"));
    } catch (error) {
      const message = skillCreatorErrorMessage(error, t, "toast.saveFailed");
      setCreatorError(message);
      showToast(message);
    } finally {
      setApplyingFeedback(false);
    }
  };

  const handlePublish = async () => {
    if (!draft) return;
    setPublishing(true);
    setCreatorError("");
    try {
      await runtimeApi.publishSkillDraft(draft.id, { accepted_tryout_ids: acceptedTryoutIds });
      onSkillCreated();
      showToast(t("toast.created"));
    } catch (error) {
      const message = skillCreatorErrorMessage(error, t, "toast.createFailed");
      setCreatorError(message);
      showToast(message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <PageHeader title={t("creator.title")} subtitle={t("creator.subtitle")} />

      <div className="creator-layout">
        <section className="creator-chat">
          <h3 className="creator-chat__title">{draft ? t("creator.tryoutTitle") : t("creator.chatTitle")}</h3>
          <div className="chat-messages">
            {!draft && chatMessages.length === 0 && (
              <p className="chat-empty">{t("creator.chatEmpty")}</p>
            )}
            {draft && (
              <p className="creator-tryout-hint">{t("creator.tryoutHint")}</p>
            )}
            {chatMessages.map((msg, i) => (
              <div
                key={msg.id}
                className={`chat-bubble chat-bubble--${msg.role} ${msg.pending ? "chat-bubble--pending" : ""} ${msg.failed ? "chat-bubble--failed" : ""}`}
                role={msg.failed ? "alert" : undefined}
                aria-live={msg.pending || msg.failed ? "polite" : undefined}
              >
                {msg.text}
                {msg.degraded && (
                  <span className="chat-bubble__status">
                    {msg.degradedReason
                      ? `${t("creator.tryoutDegraded")}：${skillCreatorErrorMessage(msg.degradedReason, t, "creator.errorModelRequestFailed")}`
                      : t("creator.tryoutDegraded")}
                  </span>
                )}
              </div>
            ))}
            {feedbackReady && (
              <section className="creator-feedback">
                <h4>{t("creator.feedbackTitle")}</h4>
                <div className="creator-feedback__tags">
                  {FEEDBACK_TAGS.map((tag) => (
                    <button
                      key={tag}
                      className={`creator-feedback__tag ${feedbackTags.has(tag) ? "creator-feedback__tag--active" : ""}`}
                      type="button"
                      onClick={() => toggleFeedbackTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <textarea
                  className="input-field creator-feedback__text"
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder={t("creator.feedbackPlaceholder")}
                />
                <div className="creator-feedback__actions">
                  <button className="btn-secondary btn-sm" type="button" onClick={handleFeedback} disabled={applyingFeedback}>
                    {t("creator.applyFeedback")}
                  </button>
                  <button className="btn-primary btn-sm" type="button" onClick={handlePublish} disabled={publishing}>
                    {t("creator.publishSkill")}
                  </button>
                </div>
              </section>
            )}
          </div>
          <div className="chat-input-row">
            <label className="creator-length-control">
              <span>{t("creator.tryoutLength")}</span>
              <select
                className="creator-length-control__select"
                value={tryoutLengthMode}
                onChange={(e) => setTryoutLengthMode(e.target.value)}
                aria-label={t("creator.tryoutLength")}
                disabled={!draft || feedbackReady}
              >
                {LENGTH_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            {tryoutLengthMode === CUSTOM_LENGTH_MODE && (
              <label className="creator-length-control creator-length-control--target">
                <span>{t("creator.customLengthTarget")}</span>
                <input
                  className="creator-length-control__input"
                  type="number"
                  min="1"
                  max={CUSTOM_LENGTH_MAX_CHARS}
                  step="1"
                  value={customLengthTarget}
                  onChange={(e) => setCustomLengthTarget(normalizeCustomLengthInput(e.target.value))}
                  aria-label={t("creator.customLengthTarget")}
                  disabled={!draft || feedbackReady}
                />
              </label>
            )}
            <input
              className="chat-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={draft ? t("creator.tryoutPlaceholder") : t("creator.chatPlaceholder")}
              disabled={!draft || feedbackReady || pendingTryout}
            />
            <button className="btn-primary btn-sm" type="button" onClick={handleSend} aria-label={t("creator.sendTryout")} disabled={!draft || feedbackReady || pendingTryout}>
              <Send size={14} aria-hidden="true" />
              <span className="creator-send-label">{t("creator.sendTryout")}</span>
            </button>
          </div>
        </section>

        <aside className="creator-sidebar">
          <label className="creator-field">
            <span>{t("creator.skillName")}</span>
            <input
              className="input-field"
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              disabled={Boolean(draft)}
            />
          </label>
          <label className="creator-field">
            <span>{t("creator.skillGoal")}</span>
            <textarea
              className="input-field creator-goal-input"
              value={skillGoal}
              onChange={(e) => setSkillGoal(e.target.value)}
              placeholder={t("creator.skillGoalPlaceholder")}
              disabled={Boolean(draft)}
            />
          </label>
          <h3 className="creator-sidebar__title">{t("creator.corpusTitle")}</h3>
          <p className="creator-sidebar__hint">{t("creator.corpusHint")}</p>

          <div className="box-checklist">
            {boxes.map((box) => {
              const meta = `${box.platform ?? "—"} · ${box.entry_count ?? 0}`;
              return (
                <label key={box.id} className="box-check-item">
                  <input
                    type="checkbox"
                    checked={selectedBoxes.has(box.id)}
                    onChange={() => toggleBox(box.id)}
                    aria-label={box.name}
                    disabled={Boolean(draft)}
                  />
                  <div>
                    <span className="box-check-item__name">{box.name}</span>
                    <span className="box-check-item__meta">{meta}</span>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="creator-sidebar__footer">
            {creationStageIndex !== null && (
              <div className="creator-stage-list" aria-live="polite">
                {CREATION_STAGE_KEYS.map((key, index) => (
                  <div
                    key={key}
                    className={[
                      "creator-stage-list__item",
                      index === creationStageIndex ? "creator-stage-list__item--active" : "",
                      index < creationStageIndex ? "creator-stage-list__item--done" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    <span className="creator-stage-list__dot" aria-hidden="true" />
                    <span>{t(key)}</span>
                  </div>
                ))}
              </div>
            )}
            {creatorError && <p className="creator-error" role="alert">{creatorError}</p>}
            <span className="creator-sidebar__stat">
              {t("creator.selectedStat")
                .replace("{count}", String(selectedBoxes.size))
                .replace("{entries}", String(totalEntries))}
            </span>
            <button
              className="btn-primary"
              type="button"
              onClick={handleCreate}
              disabled={selectedBoxes.size === 0 || !skillGoal.trim() || creating || Boolean(draft)}
            >
              <Sparkles size={14} aria-hidden="true" />
              {t("creator.createSkill")}
            </button>
            {draft && (
              <button className="btn-secondary" type="button" onClick={handlePublish} disabled={publishing}>
                {t("creator.publishSkill")}
              </button>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function normalizeCustomLengthInput(value: string): string {
  if (!value) return "";
  return String(sanitizeCustomLengthTarget(value) ?? CUSTOM_LENGTH_DEFAULT_TARGET);
}

function skillCreatorErrorMessage(error: unknown, t: (key: string) => string, fallbackKey: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (raw.includes("skill_creator_model_required")) return t("creator.errorModelRequired");
  if (raw.includes("skill_creator_model_name_missing")) return t("creator.errorModelNameMissing");
  if (raw.includes("skill_creator_model_base_url_invalid")) return t("creator.errorModelBaseUrlInvalid");
  if (raw.includes("skill_creator_model_request_failed_401") || raw.includes("skill_creator_model_request_failed_403")) return t("creator.errorModelUnauthorized");
  if (raw.includes("skill_creator_model_request_failed_429")) return t("creator.errorModelRateLimited");
  if (raw.includes("skill_creator_model_request_failed")) return t("creator.errorModelRequestFailed");
  if (raw.includes("skill_creator_material_insufficient")) return t("creator.errorMaterialInsufficient");
  if (raw.includes("skill_creator_invalid_output")) return t("creator.errorInvalidOutput");
  if (raw.includes("skill_creator_feedback_limit_reached")) return t("creator.errorFeedbackLimit");
  if (raw.includes("skill_creator_publish_blocked")) {
    const detail = raw.split(":").slice(1).join(":").trim();
    return detail ? `${t("creator.errorPublishBlocked")}：${detail}` : t("creator.errorPublishBlocked");
  }
  return t(fallbackKey);
}
