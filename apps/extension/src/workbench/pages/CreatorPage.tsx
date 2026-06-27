import { ChevronUp, Send, Sparkles, ThumbsUp, ThumbsDown, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CUSTOM_LENGTH_DEFAULT_TARGET,
  CUSTOM_LENGTH_MAX_CHARS,
  CUSTOM_LENGTH_MODE,
  sanitizeCustomLengthTarget,
} from "../../api/lengthConstraints";
import { BambooStageIndicator } from "../components/BambooStageIndicator";
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
const REJECTION_REASONS = ["不够像", "不够狠", "太油", "逻辑弱", "太长", "太短"];
const TRYOUT_PRESET_SENTENCES = [
  "加班到凌晨是年轻人该吃的苦，嫌累就是不够上进。",
  "公司拖欠工资可以理解，员工先体谅企业活下去。",
  "买到问题商品还维权，纯粹是小题大做，商家也不容易。",
  "被网暴的人别太敏感，既然发到网上就要承受所有评价。",
  "公共场合大声外放没什么，嫌吵的人自己戴耳机。",
  "孩子被同学排挤，多半是自己性格有问题，别怪别人。",
  "房东临时涨租也正常，租客不接受可以自己搬走。",
  "平台压低骑手配送时间是效率提升，送不到就是骑手能力差。",
  "论文造假只要结果有用就行，纠结过程是书呆子思维。",
  "客服态度差很正常，谁让顾客问题那么多。",
];
const CREATION_STAGE_KEYS = [
  "creator.stageValidateMaterial",
  "creator.stageReadMaterial",
  "creator.stageGenerateDraft",
  "creator.stageCompileCheck",
  "creator.stageEnterTryout",
] as const;

function waitForCreationStageFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 16);
  });
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  degraded?: boolean;
  degradedReason?: string;
  pending?: boolean;
  failed?: boolean;
  tryoutId?: number;
  rating?: "accepted" | "rejected" | null;
  rejectionReason?: string;
  annotation?: string;
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
  const [creationFailedStageIndex, setCreationFailedStageIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [acceptedTryoutIds, setAcceptedTryoutIds] = useState<number[]>([]);
  const [feedbackTags, setFeedbackTags] = useState<Set<string>>(new Set());
  const [feedbackText, setFeedbackText] = useState("");
  const [applyingFeedback, setApplyingFeedback] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [customLengthTarget, setCustomLengthTarget] = useState(String(CUSTOM_LENGTH_DEFAULT_TARGET));
  const [creatorError, setCreatorError] = useState("");
  const [rejectionDialogOpen, setRejectionDialogOpen] = useState(false);
  const [rejectionDialogMessageId, setRejectionDialogMessageId] = useState("");
  const [rejectionDialogTryoutId, setRejectionDialogTryoutId] = useState(0);
  const [annotationDialogOpen, setAnnotationDialogOpen] = useState(false);
  const [annotationDialogMessageId, setAnnotationDialogMessageId] = useState("");
  const [annotationDialogTryoutId, setAnnotationDialogTryoutId] = useState(0);
  const [annotationDialogValue, setAnnotationDialogValue] = useState("");
  const [presetOpen, setPresetOpen] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const presetBoxRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!presetOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!presetBoxRef.current?.contains(event.target as Node)) {
        setPresetOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [presetOpen]);

  const pendingTryout = chatMessages.some((msg) => msg.role === "assistant" && msg.pending);
  const completedRounds = chatMessages.filter((msg) => msg.role === "assistant" && !msg.pending && !msg.failed).length;
  const maxRounds = Math.max(3, Math.min(10, Math.round(tryoutRounds || 3)));
  const feedbackReady = Boolean(draft && completedRounds >= maxRounds);
  const tryoutInputDisabled = !draft || feedbackReady || pendingTryout;

  useEffect(() => {
    if (tryoutInputDisabled) setPresetOpen(false);
  }, [tryoutInputDisabled]);

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
        lengthMode: CUSTOM_LENGTH_MODE,
        customLengthTarget: sanitizeCustomLengthTarget(customLengthTarget) ?? CUSTOM_LENGTH_DEFAULT_TARGET,
      });
      setChatMessages((prev) => prev.map((msg) => (
        msg.id === pendingId
          ? { ...msg, text: result.reply, degraded: result.degraded, degradedReason: result.degraded_reason, pending: false, tryoutId: result.id }
          : msg
      )));
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

  const selectTryoutPreset = (sentence: string) => {
    if (tryoutInputDisabled) return;
    setChatInput(sentence);
    setPresetOpen(false);
    chatInputRef.current?.focus();
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
    let currentStage = 0;
    setCreating(true);
    setCreationFailedStageIndex(null);
    setCreationStageIndex(currentStage);
    setCreatorError("");
    try {
      await waitForCreationStageFrame();
      currentStage = 1;
      setCreationStageIndex(currentStage);
      await waitForCreationStageFrame();
      currentStage = 2;
      setCreationStageIndex(currentStage);
      await waitForCreationStageFrame();
      const next = await runtimeApi.createSkillDraft({
        source_box_ids: Array.from(selectedBoxes),
        skill_name: skillName.trim() || "Clapback Skill",
        skill_goal: skillGoal.trim(),
      });
      currentStage = 3;
      setCreationStageIndex(currentStage);
      await waitForCreationStageFrame();
      currentStage = 4;
      setCreationStageIndex(currentStage);
      setDraft(next);
      setChatMessages([]);
      setAcceptedTryoutIds([]);
      showToast(t("toast.created"));
    } catch (error) {
      const message = skillCreatorErrorMessage(error, t, "toast.createFailed");
      setCreationStageIndex(null);
      setCreationFailedStageIndex(currentStage);
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

  const handleRateTryout = async (messageId: string, tryoutId: number, rating: "accepted" | "rejected" | null, rejectionReason?: string) => {
    try {
      const result = await runtimeApi.rateTryout(tryoutId, { rating, rejectionReason, annotation: undefined });
      setChatMessages((prev) => prev.map((msg) =>
        msg.id === messageId
          ? { ...msg, rating: result.user_rating, rejectionReason: result.rejection_reason, annotation: result.user_annotation }
          : msg
      ));
      if (rating === "accepted") {
        setAcceptedTryoutIds((prev) => prev.includes(tryoutId) ? prev : [...prev, tryoutId]);
      } else if (rating === "rejected") {
        setAcceptedTryoutIds((prev) => prev.filter((id) => id !== tryoutId));
      }
    } catch (error) {
      const message = skillCreatorErrorMessage(error, t, "creator.rateFailed");
      showToast(message);
    }
  };

  const handleAnnotateTryout = async (messageId: string, tryoutId: number, annotation: string) => {
    try {
      const msg = chatMessages.find((m) => m.id === messageId);
      const result = await runtimeApi.rateTryout(tryoutId, {
        rating: msg?.rating ?? null,
        rejectionReason: msg?.rejectionReason,
        annotation
      });
      setChatMessages((prev) => prev.map((m) =>
        m.id === messageId
          ? { ...m, annotation: result.user_annotation }
          : m
      ));
    } catch (error) {
      const message = skillCreatorErrorMessage(error, t, "creator.annotateFailed");
      showToast(message);
    }
  };

  const openRejectionDialog = (messageId: string, tryoutId: number) => {
    setRejectionDialogMessageId(messageId);
    setRejectionDialogTryoutId(tryoutId);
    setRejectionDialogOpen(true);
  };

  const closeRejectionDialog = () => {
    setRejectionDialogOpen(false);
    setRejectionDialogMessageId("");
    setRejectionDialogTryoutId(0);
  };

  const confirmRejection = (reason: string) => {
    handleRateTryout(rejectionDialogMessageId, rejectionDialogTryoutId, "rejected", reason);
    closeRejectionDialog();
  };

  const openAnnotationDialog = (messageId: string, tryoutId: number, currentAnnotation: string) => {
    setAnnotationDialogMessageId(messageId);
    setAnnotationDialogTryoutId(tryoutId);
    setAnnotationDialogValue(currentAnnotation);
    setAnnotationDialogOpen(true);
  };

  const closeAnnotationDialog = () => {
    setAnnotationDialogOpen(false);
    setAnnotationDialogMessageId("");
    setAnnotationDialogTryoutId(0);
    setAnnotationDialogValue("");
  };

  const confirmAnnotation = () => {
    handleAnnotateTryout(annotationDialogMessageId, annotationDialogTryoutId, annotationDialogValue);
    closeAnnotationDialog();
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
              <div key={msg.id}>
                <div
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
                {msg.role === "assistant" && !msg.pending && !msg.failed && msg.tryoutId && (
                  <div className="tryout-actions">
                    <button
                      type="button"
                      className={`tryout-action ${msg.rating === "accepted" ? "tryout-action--active" : ""}`}
                      onClick={() => handleRateTryout(msg.id, msg.tryoutId!, msg.rating === "accepted" ? null : "accepted")}
                      title={t("creator.acceptTryout")}
                    >
                      <ThumbsUp size={16} />
                      <span>{t("creator.accept")}</span>
                    </button>
                    <button
                      type="button"
                      className={`tryout-action ${msg.rating === "rejected" ? "tryout-action--active" : ""}`}
                      onClick={() => {
                        if (msg.rating === "rejected") {
                          handleRateTryout(msg.id, msg.tryoutId!, null);
                        } else {
                          openRejectionDialog(msg.id, msg.tryoutId!);
                        }
                      }}
                      title={t("creator.rejectTryout")}
                    >
                      <ThumbsDown size={16} />
                      <span>{t("creator.reject")}</span>
                    </button>
                    <button
                      type="button"
                      className={`tryout-action ${msg.annotation ? "tryout-action--active" : ""}`}
                      onClick={() => {
                        openAnnotationDialog(msg.id, msg.tryoutId!, msg.annotation ?? "");
                      }}
                      title={t("creator.annotateTryout")}
                    >
                      <PenLine size={16} />
                      <span>{t("creator.annotate")}</span>
                    </button>
                    {msg.rejectionReason && (
                      <span className="tryout-meta">{t("creator.reason")}: {msg.rejectionReason}</span>
                    )}
                    {msg.annotation && (
                      <span className="tryout-meta">{t("creator.annotation")}: {msg.annotation}</span>
                    )}
                  </div>
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
            <div className="tryout-input-combobox" ref={presetBoxRef}>
              {presetOpen && (
                <div
                  id="creator-tryout-presets"
                  className="tryout-preset-list"
                  role="listbox"
                  aria-label={t("creator.tryoutPresetList")}
                >
                  {TRYOUT_PRESET_SENTENCES.map((sentence) => (
                    <button
                      key={sentence}
                      type="button"
                      className="tryout-preset-option"
                      role="option"
                      onClick={() => selectTryoutPreset(sentence)}
                    >
                      {sentence}
                    </button>
                  ))}
                </div>
              )}
              <input
                ref={chatInputRef}
                className="chat-input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setPresetOpen(false);
                    return;
                  }
                  if (e.key === "Enter") handleSend();
                }}
                placeholder={draft ? t("creator.tryoutPlaceholder") : t("creator.chatPlaceholder")}
                disabled={tryoutInputDisabled}
                aria-controls={presetOpen ? "creator-tryout-presets" : undefined}
                aria-expanded={presetOpen}
                aria-haspopup="listbox"
              />
              <button
                className="tryout-preset-toggle"
                type="button"
                aria-label={t("creator.tryoutPresetToggle")}
                aria-expanded={presetOpen}
                onClick={() => setPresetOpen((open) => !open)}
                disabled={tryoutInputDisabled}
              >
                <ChevronUp size={16} aria-hidden="true" />
              </button>
            </div>
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
          <p className="creator-sidebar__hint" style={{ marginTop: "4px", color: "var(--ink-light)" }}>
            {t("creator.corpusMaterialLimit")}
          </p>

          <div className="box-checklist">
            {boxes.map((box) => {
              const meta = `${box.platform ?? "—"} · ${box.entry_count ?? 0}`;
              return (
                <label key={box.id} className="box-check-item">
                  <input
                    className="workbench-checkbox"
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
            {(creationStageIndex !== null || creationFailedStageIndex !== null) && (
              <div className="creator-stage-list" aria-live="polite">
                {CREATION_STAGE_KEYS.map((key, index) => {
                  const progressIndex = creationFailedStageIndex ?? creationStageIndex;
                  const isFailed = index === creationFailedStageIndex;

                  let status: "pending" | "active" | "done" | "failed";
                  if (isFailed) {
                    status = "failed";
                  } else if (creationFailedStageIndex === null && index === creationStageIndex) {
                    status = "active";
                  } else if (progressIndex !== null && index < progressIndex) {
                    status = "done";
                  } else {
                    status = "pending";
                  }

                  return (
                    <div key={key} className={`creator-stage-list__item creator-stage-list__item--${status}`}>
                      <BambooStageIndicator status={status} stageIndex={index} />
                      <span className="creator-stage-list__text">{t(key)}</span>
                      {isFailed && <span className="creator-stage-list__status">{t("creator.stageFailed")}</span>}
                    </div>
                  );
                })}
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

      {rejectionDialogOpen && (
        <div className="modal-overlay" onClick={closeRejectionDialog}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-dialog__title">{t("creator.selectRejectionReason")}</h3>
            <div className="modal-dialog__reasons">
              {REJECTION_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className="modal-dialog__reason-btn"
                  onClick={() => confirmRejection(reason)}
                >
                  {reason}
                </button>
              ))}
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={closeRejectionDialog}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {annotationDialogOpen && (
        <div className="modal-overlay" onClick={closeAnnotationDialog}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-dialog__title">{t("creator.annotationPrompt")}</h3>
            <textarea
              className="input-field modal-dialog__textarea"
              value={annotationDialogValue}
              onChange={(e) => setAnnotationDialogValue(e.target.value)}
              placeholder={t("creator.annotationPrompt")}
              rows={4}
            />
            <div className="modal-dialog__actions">
              <button type="button" className="btn-secondary btn-sm" onClick={closeAnnotationDialog}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn-primary btn-sm" onClick={confirmAnnotation}>
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
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
  if (raw.includes("skill_creator_model_timeout")) return t("creator.errorModelTimeout");
  if (raw.includes("skill_creator_model_output_truncated")) return t("creator.errorModelOutputTruncated");
  if (raw.includes("skill_creator_model_request_failed_401") || raw.includes("skill_creator_model_request_failed_403")) return t("creator.errorModelUnauthorized");
  if (raw.includes("skill_creator_model_request_failed_429")) return t("creator.errorModelRateLimited");
  if (raw.includes("skill_creator_model_request_failed")) return t("creator.errorModelRequestFailed");
  if (raw.includes("skill_creator_tryout_too_short") || raw.includes("skill_creator_tryout_length_out_of_range")) return t("creator.errorTryoutLengthOutOfRange");
  if (raw.includes("skill_creator_material_insufficient")) return t("creator.errorMaterialInsufficient");
  if (raw.includes("skill_creator_invalid_output")) return t("creator.errorInvalidOutput");
  if (raw.includes("skill_creator_feedback_limit_reached")) return t("creator.errorFeedbackLimit");
  if (raw.includes("skill_creator_publish_blocked")) {
    const detail = raw.split(":").slice(1).join(":").trim();
    return detail ? `${t("creator.errorPublishBlocked")}：${detail}` : t("creator.errorPublishBlocked");
  }
  return t(fallbackKey);
}
