export type LengthSettings = {
  lengthMode: string;
  customLengthTarget?: number;
  platform?: string;
};

export type LengthConstraint = {
  label: string;
  maxChars: number;
  minChars?: number;
  targetChars?: number;
};

export const CUSTOM_LENGTH_MODE = "自定义";
export const CUSTOM_LENGTH_DEFAULT_TARGET = 20;
export const CUSTOM_LENGTH_MAX_CHARS = 200;

const PRESET_LENGTH_CONSTRAINTS: Record<string, LengthConstraint> = {
  "10字以内": { label: "不超过 10 个汉字", maxChars: 10 },
  "20字以内": { label: "不超过 20 个汉字", maxChars: 20 },
  "30字以内": { label: "不超过 30 个汉字", maxChars: 30 },
  短: { label: "短句，不超过 20 个汉字", maxChars: 20 },
  中: { label: "中等长度，不超过 40 个汉字", maxChars: 40 },
  展开: { label: "可展开，但不超过 90 个汉字", maxChars: 90 },
};

export const LENGTH_OPTIONS: string[] = [
  ...Object.keys(PRESET_LENGTH_CONSTRAINTS),
  CUSTOM_LENGTH_MODE,
];

export function resolveLengthConstraint(settings: LengthSettings): LengthConstraint {
  if (settings.lengthMode === CUSTOM_LENGTH_MODE) {
    const target = sanitizeCustomLengthTarget(settings.customLengthTarget) ?? CUSTOM_LENGTH_DEFAULT_TARGET;
    const { minChars, maxChars } = customLengthBounds(target);
    return {
      label: `目标 ${target} 个汉字，完整表达优先，标点不计入字数`,
      maxChars,
      minChars,
      targetChars: target,
    };
  }

  return PRESET_LENGTH_CONSTRAINTS[settings.lengthMode] ?? PRESET_LENGTH_CONSTRAINTS["短"];
}

export function sanitizeCustomLengthTarget(value: unknown): number | undefined {
  return clampInteger(value, 1, CUSTOM_LENGTH_MAX_CHARS);
}

export function countEffectiveChars(value: string): number {
  return [...value].filter(isEffectiveChar).length;
}

export function trimToMaxChars(value: string, maxChars: number): string {
  const chars = [...value.trim()];
  if (countEffectiveChars(value) <= maxChars) return chars.join("");

  let used = 0;
  let result = "";
  for (const char of chars) {
    if (isEffectiveChar(char)) {
      if (used >= maxChars) break;
      used += 1;
      result += char;
      if (used >= maxChars) break;
      continue;
    }
    result += char;
  }
  return result.replace(/[，。！？、,.!?；;：:]+$/g, "").trim();
}

export function isWithinLengthConstraint(value: string, constraint: LengthConstraint): boolean {
  const length = countEffectiveChars(value.trim());
  if (length === 0 || length > constraint.maxChars) return false;
  return constraint.minChars === undefined || length >= constraint.minChars;
}

export function fitToLengthConstraint(
  value: string,
  constraint: LengthConstraint,
  paddingSegments: string[] = DEFAULT_LENGTH_PADDING_SEGMENTS,
): string {
  let result = trimToMaxChars(value, constraint.maxChars);
  if (constraint.minChars === undefined || countEffectiveChars(result) >= constraint.minChars) return result;

  for (const segment of paddingSegments) {
    result = appendWithinMax(result, segment, constraint.maxChars);
    if (countEffectiveChars(result) >= constraint.minChars) return result;
  }

  while (countEffectiveChars(result) < constraint.minChars) {
    const next = appendWithinMax(result, "再把证据和前提补齐", constraint.maxChars);
    if (next === result) break;
    result = next;
  }
  return result;
}

const DEFAULT_LENGTH_PADDING_SEGMENTS = [
  "先把证据补上",
  "再说明前提",
  "否则只是情绪判断",
  "结论站不稳",
];

function appendWithinMax(base: string, segment: string, maxChars: number): string {
  const cleanBase = base.trim();
  const cleanSegment = segment.trim();
  if (!cleanSegment) return cleanBase;
  const separator = cleanBase && !/[，。！？、,.!?；;：:]$/.test(cleanBase) ? "，" : "";
  const remaining = maxChars - countEffectiveChars(cleanBase);
  if (remaining <= 0) return cleanBase;
  const fittingSegment = trimToMaxChars(cleanSegment, remaining);
  if (!fittingSegment) return cleanBase;
  return `${cleanBase}${separator}${fittingSegment}`;
}

function customLengthBounds(target: number): { minChars: number; maxChars: number } {
  if (target <= 10) {
    return {
      minChars: Math.max(1, Math.floor(target * 0.5)),
      maxChars: Math.min(CUSTOM_LENGTH_MAX_CHARS, Math.ceil(target * 2)),
    };
  }
  if (target <= 30) {
    return {
      minChars: Math.max(1, Math.floor(target * 0.5)),
      maxChars: Math.min(CUSTOM_LENGTH_MAX_CHARS, Math.ceil(target * 1.75)),
    };
  }
  if (target <= 80) {
    return {
      minChars: Math.max(1, Math.floor(target * 0.6)),
      maxChars: Math.min(CUSTOM_LENGTH_MAX_CHARS, Math.ceil(target * 1.6)),
    };
  }
  if (target <= 120) {
    return {
      minChars: Math.max(1, Math.floor(target * 0.75)),
      maxChars: Math.min(CUSTOM_LENGTH_MAX_CHARS, Math.ceil(target * 1.5)),
    };
  }
  return {
    minChars: Math.max(1, Math.floor(target * 0.75)),
    maxChars: Math.min(CUSTOM_LENGTH_MAX_CHARS, Math.ceil(target * 1.35)),
  };
}

function isEffectiveChar(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char);
}

function clampInteger(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
