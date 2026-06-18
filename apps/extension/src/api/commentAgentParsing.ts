import type { ExecutionAngle, SkillActivationPlan } from "./commentAgentTypes";

export function parseSkillActivationPlan(content: string):
  | { ok: true; plan: SkillActivationPlan }
  | { ok: false; detail: string } {
  const text = stripFence(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "parse_failed" };
  }
  return normalizeActivationPlan(parsed);
}

export function parseCandidateOutput(content: string): { ok: true; candidates: string[] } | { ok: false; detail: string } {
  const json = parseCandidateJson(content);
  if (json.ok) return json;
  const lineCandidates = parseCandidateLines(content);
  if (lineCandidates.length > 0) return { ok: true, candidates: lineCandidates };
  const freeText = cleanCandidateLine(stripFence(content));
  if (freeText && !isNonCandidateLine(freeText)) return { ok: true, candidates: [freeText] };
  return { ok: false, detail: `${json.detail}; no_candidate_text` };
}

function normalizeActivationPlan(value: unknown):
  | { ok: true; plan: SkillActivationPlan }
  | { ok: false; detail: string } {
  if (!isRecord(value)) return { ok: false, detail: "plan_not_object" };
  const skillIdentity = stringArray(value.skillIdentity);
  const targetReading = stringValue(value.targetReading);
  const attackDirection = stringValue(value.attackDirection);
  const sharedConstraints = stringArray(value.sharedConstraints);
  const forbiddenPatterns = stringArray(value.forbiddenPatterns);
  const lengthStrategy = stringValue(value.lengthStrategy);
  const angles = Array.isArray(value.angles)
    ? value.angles.map(normalizeAngle).filter((angle): angle is ExecutionAngle => angle !== null)
    : [];

  const errors: string[] = [];
  if (skillIdentity.length < 1) errors.push("skillIdentity_required");
  if (!targetReading) errors.push("targetReading_required");
  if (!attackDirection) errors.push("attackDirection_required");
  if (sharedConstraints.length < 1) errors.push("sharedConstraints_required");
  if (angles.length < 3) errors.push("angles_min_3");
  if (errors.length > 0) return { ok: false, detail: errors.join(",") };

  return {
    ok: true,
    plan: {
      skillIdentity: skillIdentity.map((item) => truncate(item, 40)).slice(0, 6),
      targetReading: truncate(targetReading, 220),
      attackDirection: truncate(attackDirection, 180),
      sharedConstraints: sharedConstraints.map((item) => truncate(item, 80)).slice(0, 8),
      forbiddenPatterns: forbiddenPatterns.map((item) => truncate(item, 60)).slice(0, 8),
      angles: angles.map(normalizeAngleLength).slice(0, 5),
      lengthStrategy: truncate(lengthStrategy, 180),
    },
  };
}

function normalizeAngle(value: unknown): ExecutionAngle | null {
  if (!isRecord(value)) return null;
  const focus = stringValue(value.focus);
  const howToApply = firstStringValue(value.howToApply, value.how, value.application, value.apply, value.method);
  const styleNote = firstStringValue(value.styleNote, value.style_note, value.style, value.tone);
  if (!focus || !howToApply || !styleNote) return null;
  return {
    id: stringValue(value.id) || `angle-${hashText(`${focus}\n${howToApply}\n${styleNote}`)}`,
    focus,
    howToApply,
    styleNote,
  };
}

function parseCandidateJson(content: string): { ok: true; candidates: string[] } | { ok: false; detail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(content));
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "parse_failed" };
  }
  if (!isRecord(parsed)) return { ok: false, detail: "candidate_json_not_object" };
  if (Array.isArray(parsed.candidates)) {
    return {
      ok: true,
      candidates: parsed.candidates
        .map((candidate) => typeof candidate === "string" ? candidate.trim() : "")
        .filter(Boolean),
    };
  }
  if (typeof parsed.content === "string" || typeof parsed.text === "string") {
    return { ok: true, candidates: [String(parsed.content ?? parsed.text).trim()].filter(Boolean) };
  }
  return { ok: false, detail: "missing_candidates_array" };
}

function parseCandidateLines(content: string): string[] {
  return stripFence(content)
    .replace(/\s+(?=(?:[-*•]\s+|\d{1,2}[.)、]\s+|[（(]?\d{1,2}[）)]\s+|[一二三四五六七八九十]+[、.)]\s+))/g, "\n")
    .split(/\r?\n/)
    .map(cleanCandidateLine)
    .filter((line) => line.length > 0 && !isNonCandidateLine(line));
}

function cleanCandidateLine(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*•]\s*|\d{1,2}[.)、]\s*|[（(]?\d{1,2}[）)]\s*|[一二三四五六七八九十]+[、.)]\s*)/, "")
    .replace(/^候选\s*[一二三四五六七八九十\d]*\s*[:：]\s*/, "")
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .trim();
}

function isNonCandidateLine(line: string): boolean {
  return /^(```|以下|好的|当然|输出要求|长度要求|平台[:：]|目标评论[:：]|意图[:：]|任务[:：])/i.test(line);
}

function stripFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  const text = stringValue(value);
  return text ? splitListText(text) : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstStringValue(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function splitListText(value: string): string[] {
  const parts = value
    .split(/(?:\r?\n|[；;]|(?:\s+[\/|]\s+))/)
    .map((item) => item.replace(/^[\s\-*•\d.、)）(（]+/, "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [value.trim()];
}

function normalizeAngleLength(angle: ExecutionAngle): ExecutionAngle {
  return {
    id: truncate(angle.id, 40),
    focus: truncate(angle.focus, 48),
    howToApply: truncate(angle.howToApply, 140),
    styleNote: truncate(angle.styleNote, 100),
  };
}

function truncate(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? compact.slice(0, limit) : compact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
