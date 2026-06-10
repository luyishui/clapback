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
export const LENGTH_OPTIONS = ["10字以内", "20字以内", "30字以内", "短", "中", "展开", CUSTOM_LENGTH_MODE] as const;

const PRESET_LENGTH_CONSTRAINTS: Record<string, LengthConstraint> = {
  "10字以内": { label: "不超过 10 个汉字", maxChars: 10 },
  "20字以内": { label: "不超过 20 个汉字", maxChars: 20 },
  "30字以内": { label: "不超过 30 个汉字", maxChars: 30 },
  短: { label: "短句，不超过 20 个汉字", maxChars: 20 },
  中: { label: "中等长度，不超过 40 个汉字", maxChars: 40 },
  展开: { label: "可展开，但不超过 90 个汉字", maxChars: 90 },
};

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

function clampInteger(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
