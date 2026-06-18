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
    if (target <= 10) {
      return {
        label: `目标 ${target} 个汉字，最多 ${target} 个汉字`,
        maxChars: target,
        targetChars: target,
      };
    }
    const minChars = Math.max(1, target - 6);
    const maxChars = Math.min(CUSTOM_LENGTH_MAX_CHARS, target + 10);
    return {
      label: `目标 ${target} 个汉字，尽量控制在 ${minChars} 到 ${maxChars} 个汉字`,
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

export function trimToMaxChars(value: string, maxChars: number): string {
  const chars = [...value.trim()];
  if (chars.length <= maxChars) return chars.join("");
  return chars.slice(0, Math.max(0, maxChars)).join("").replace(/[，。！？、,.!?；;：:]+$/g, "").trim();
}

export function isWithinLengthConstraint(value: string, constraint: LengthConstraint): boolean {
  const length = [...value.trim()].length;
  if (length === 0 || length > constraint.maxChars) return false;
  return constraint.minChars === undefined || length >= constraint.minChars;
}

export function fitToLengthConstraint(
  value: string,
  constraint: LengthConstraint,
  paddingSegments: string[] = DEFAULT_LENGTH_PADDING_SEGMENTS,
): string {
  let result = trimToMaxChars(value, constraint.maxChars);
  if (constraint.minChars === undefined || [...result].length >= constraint.minChars) return result;

  for (const segment of paddingSegments) {
    result = appendWithinMax(result, segment, constraint.maxChars);
    if ([...result].length >= constraint.minChars) return result;
  }

  while ([...result].length < constraint.minChars) {
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
  const remaining = maxChars - [...cleanBase].length;
  if (remaining <= 0) return cleanBase;
  const segmentBudget = remaining - [...separator].length;
  if (segmentBudget <= 0) return cleanBase;
  const fittingSegment = [...cleanSegment].slice(0, segmentBudget).join("");
  return `${cleanBase}${separator}${fittingSegment}`;
}

function clampInteger(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
