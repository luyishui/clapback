import { describe, expect, it } from "vitest";
import fullFireExamples from "../../../runtime/clapback_runtime/system_skills/full_fire/examples.jsonl?raw";
import restrainedExamples from "../../../runtime/clapback_runtime/system_skills/restrained_breakdown/examples.jsonl?raw";
import sarcasticExamples from "../../../runtime/clapback_runtime/system_skills/sarcastic_ironic/examples.jsonl?raw";
import wenyanExamples from "../../../runtime/clapback_runtime/system_skills/wenyan_attack/examples.jsonl?raw";
import { getBuiltinSkillDetails } from "./builtinSkills";
import {
  countSamplesByLength,
  normalizeSkillSamples,
  parseExamplesJsonl,
  resolveSampleLengthBucket,
  samplesFromSkillDetail,
  selectSampleForLength,
} from "./skillSamples";

describe("skill sample normalization", () => {
  it.each([
    ["full_fire", fullFireExamples, { "短": 10, "中": 10, "长": 10 }],
    ["restrained_breakdown", restrainedExamples, { "短": 4, "中": 4, "长": 4 }],
    ["sarcastic_ironic", sarcasticExamples, { "短": 10, "中": 10, "长": 10 }],
    ["wenyan_attack", wenyanExamples, { "短": 5, "中": 5, "长": 5 }],
  ])("groups %s examples into stable length buckets", (_skillId, raw, expected) => {
    const samples = normalizeSkillSamples(parseExamplesJsonl(raw));

    expect(countSamplesByLength(samples)).toEqual(expected);
    expect(samples.every((sample) => sample.id.startsWith(`${sample.lengthBucket}-`))).toBe(true);
  });

  it("maps generation length settings to sample buckets", () => {
    expect(resolveSampleLengthBucket({ lengthMode: "10字以内" })).toBe("短");
    expect(resolveSampleLengthBucket({ lengthMode: "20字以内" })).toBe("短");
    expect(resolveSampleLengthBucket({ lengthMode: "短" })).toBe("短");
    expect(resolveSampleLengthBucket({ lengthMode: "30字以内" })).toBe("中");
    expect(resolveSampleLengthBucket({ lengthMode: "中" })).toBe("中");
    expect(resolveSampleLengthBucket({ lengthMode: "展开" })).toBe("长");
    expect(resolveSampleLengthBucket({ lengthMode: "自定义", customLengthTarget: 20 })).toBe("中");
    expect(resolveSampleLengthBucket({ lengthMode: "自定义", customLengthTarget: 21 })).toBe("中");
    expect(resolveSampleLengthBucket({ lengthMode: "自定义", customLengthTarget: 50 })).toBe("长");
  });

  it("selects the saved sample for the active bucket and falls back to the first bucket sample", () => {
    const samples = normalizeSkillSamples(parseExamplesJsonl(wenyanExamples));
    const mediumSamples = samples.filter((sample) => sample.lengthBucket === "中");
    const saved = mediumSamples[1];

    expect(selectSampleForLength(samples, { "中": saved.id }, { lengthMode: "30字以内" })?.id).toBe(saved.id);
    expect(selectSampleForLength(samples, {}, { lengthMode: "30字以内" })?.id).toBe(mediumSamples[0].id);
    expect(selectSampleForLength([], {}, { lengthMode: "30字以内" })).toBeNull();
  });

  it("falls back to files examples.jsonl when sample_outputs is absent", () => {
    const samples = samplesFromSkillDetail({
      sample_outputs: [],
      files: {
        "examples.jsonl": [
          '{"input":"别焦虑","output":"先看证据。"}',
          '{"input":"别焦虑","output":"先看证据，再决定要不要焦虑。"}',
          '{"input":"别焦虑","output":"先把证据摆出来，再谈焦虑值不值得。"}',
        ].join("\n"),
      },
    });

    expect(countSamplesByLength(samples)).toEqual({ "短": 1, "中": 1, "长": 1 });
    expect(selectSampleForLength(samples, {}, { lengthMode: "展开" })?.output).toBe("先把证据摆出来，再谈焦虑值不值得。");
  });

  it("loads every runtime example into builtin Skill details without stale pseudo-metric samples", () => {
    const details = Object.fromEntries(getBuiltinSkillDetails().map((detail) => [detail.id, detail]));

    expect(countSamplesByLength(normalizeSkillSamples(details.full_fire.sample_outputs))).toEqual({ "短": 3, "中": 3, "长": 0 });
    expect(countSamplesByLength(normalizeSkillSamples(details.restrained_breakdown.sample_outputs))).toEqual({ "短": 1, "中": 1, "长": 1 });
    expect(countSamplesByLength(normalizeSkillSamples(details.sarcastic_ironic.sample_outputs))).toEqual({ "短": 1, "中": 1, "长": 1 });
    expect(countSamplesByLength(normalizeSkillSamples(details.wenyan_attack.sample_outputs))).toEqual({ "短": 2, "中": 1, "长": 1 });

    const allSampleText = getBuiltinSkillDetails()
      .flatMap((detail) => detail.sample_outputs)
      .map((sample) => `${sample.prompt ?? sample.input ?? ""}\n${sample.reply ?? sample.output ?? ""}`)
      .join("\n");
    expect(allSampleText).not.toMatch(/人文代保真率|保真率|纯度|浓度|阈值|因子|指数|0\.0003%|百分之百/);
  });
});
