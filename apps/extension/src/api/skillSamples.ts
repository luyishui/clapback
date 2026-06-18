export type SampleLengthBucket = "短" | "中" | "长";

export type RawSkillSample = {
  prompt?: string;
  reply?: string;
  input?: string;
  output?: string;
  source?: string;
  length?: SampleLengthBucket;
  lengthBucket?: SampleLengthBucket;
};

export type SkillSample = {
  id: string;
  input: string;
  output: string;
  prompt: string;
  reply: string;
  source?: string;
  lengthBucket: SampleLengthBucket;
  topicIndex: number;
  originalIndex: number;
};

export type SkillSampleSelection = Partial<Record<SampleLengthBucket, string>>;
export type SkillSampleSelections = Record<string, SkillSampleSelection>;

export type SampleLengthSettings = {
  lengthMode: string;
  customLengthTarget?: number;
};

export type SkillSampleSource = {
  sample_outputs?: RawSkillSample[];
  files?: Record<string, string> | undefined;
};

const LENGTH_BUCKETS: SampleLengthBucket[] = ["短", "中", "长"];

export function parseExamplesJsonl(raw: string): RawSkillSample[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return isRecord(parsed) ? [parsed as RawSkillSample] : [];
      } catch {
        return [];
      }
    });
}

export function normalizeSkillSamples(rawSamples: RawSkillSample[] | undefined): SkillSample[] {
  const usable = (rawSamples ?? [])
    .map((sample, index) => {
      const input = stringValue(sample.input) || stringValue(sample.prompt);
      const output = stringValue(sample.output) || stringValue(sample.reply);
      if (!input || !output) return null;
      return {
        input,
        output,
        source: stringValue(sample.source) || undefined,
        explicitBucket: normalizeBucket(sample.lengthBucket) ?? normalizeBucket(sample.length),
        originalIndex: index,
      };
    })
    .filter((sample): sample is NonNullable<typeof sample> => sample !== null);

  const grouped = new Map<string, typeof usable>();
  for (const sample of usable) {
    const group = grouped.get(sample.input) ?? [];
    group.push(sample);
    grouped.set(sample.input, group);
  }

  const result: SkillSample[] = [];
  let topicIndex = 0;
  for (const group of grouped.values()) {
    const sorted = [...group].sort((a, b) => {
      const lengthDiff = countChars(a.output) - countChars(b.output);
      return lengthDiff || a.originalIndex - b.originalIndex;
    });
    const bucketByIndex = inferBuckets(sorted.length);
    for (let index = 0; index < sorted.length; index += 1) {
      const sample = sorted[index];
      const lengthBucket = sample.explicitBucket ?? bucketByIndex[index];
      result.push({
        id: `${lengthBucket}-${hashSample(`${sample.input}\n${sample.output}`)}`,
        input: sample.input,
        output: sample.output,
        prompt: sample.input,
        reply: sample.output,
        source: sample.source,
        lengthBucket,
        topicIndex,
        originalIndex: sample.originalIndex,
      });
    }
    topicIndex += 1;
  }

  return result.sort((a, b) => a.originalIndex - b.originalIndex);
}

export function samplesFromSkillDetail(skill: SkillSampleSource | null | undefined): SkillSample[] {
  const rawSamples = Array.isArray(skill?.sample_outputs) && skill.sample_outputs.length > 0
    ? skill.sample_outputs
    : parseExamplesJsonl(skill?.files?.["examples.jsonl"] ?? "");
  return normalizeSkillSamples(rawSamples);
}

export function countSamplesByLength(samples: SkillSample[]): Record<SampleLengthBucket, number> {
  return {
    "短": samples.filter((sample) => sample.lengthBucket === "短").length,
    "中": samples.filter((sample) => sample.lengthBucket === "中").length,
    "长": samples.filter((sample) => sample.lengthBucket === "长").length,
  };
}

export function resolveSampleLengthBucket(settings: SampleLengthSettings): SampleLengthBucket {
  if (settings.lengthMode === "自定义") {
    const target = typeof settings.customLengthTarget === "number" ? settings.customLengthTarget : 20;
    if (target <= 10) return "短";
    if (target <= 30) return "中";
    return "长";
  }
  if (settings.lengthMode === "10字以内" || settings.lengthMode === "20字以内" || settings.lengthMode === "短") {
    return "短";
  }
  if (settings.lengthMode === "30字以内" || settings.lengthMode === "中") {
    return "中";
  }
  return "长";
}

export function selectSampleForLength(
  samples: SkillSample[],
  selection: SkillSampleSelection | undefined,
  settings: SampleLengthSettings | SampleLengthBucket,
): SkillSample | null {
  const bucket = typeof settings === "string" ? settings : resolveSampleLengthBucket(settings);
  const bucketSamples = samples.filter((sample) => sample.lengthBucket === bucket);
  if (bucketSamples.length === 0) return null;
  const selectedId = selection?.[bucket];
  return bucketSamples.find((sample) => sample.id === selectedId) ?? bucketSamples[0];
}

export function formatSelectedSampleForPrompt(sample: SkillSample | null): string {
  if (!sample) return "";
  return [
    "Selected Sample:",
    "仅供风格参考；最终字数必须服从长度要求。",
    "样本边界: 只模仿语气、节奏和攻击方式；不要复用样本里的话题、实体、例子或事实。",
    `Input: ${sample.input}`,
    `Output: ${sample.output}`,
    "Vocabulary rule: 不要编造保真率、指数、纯度、浓度、阈值、因子、百分比评分等不存在的指标；词汇只能来自目标文本、Skill、弹药箱、公共常识或真实热词。",
  ].join("\n");
}

export function sampleBuckets(): SampleLengthBucket[] {
  return [...LENGTH_BUCKETS];
}

function inferBuckets(size: number): SampleLengthBucket[] {
  if (size <= 0) return [];
  if (size === 1) return ["中"];
  if (size === 2) return ["短", "长"];
  return Array.from({ length: size }, (_, index) => {
    if (index === 0) return "短";
    if (index === size - 1) return "长";
    return "中";
  });
}

function normalizeBucket(value: unknown): SampleLengthBucket | null {
  return value === "短" || value === "中" || value === "长" ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function countChars(value: string): number {
  return [...value].length;
}

function hashSample(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
