import type { SkillDetail, SkillInfo } from "../workbench/runtimeApi";

type BuiltinSkill = SkillDetail & { builtin: true };

const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    id: "full_fire",
    name: "焚锋",
    goal: "高压、短促、直接地反击低质量言论。",
    summary: "适合需要强攻击性的日常嘴替候选。",
    version: "0.1.0",
    score: 72,
    confidence: "medium",
    recommended_default: true,
    compile_status: "builtin",
    source: "builtin",
    lineage: "extension-builtin",
    risk_tips: ["不要自动发布；用户需要自行选择和编辑。"],
    quality: { seeded: true },
    skill_md: "# 焚锋\n\n高压、短促、直接地反击低质量言论。",
    sample_outputs: [
      { prompt: "你这不就是杠吗？", reply: "不是我杠，是你的逻辑还没站稳。" },
    ],
    files: {
      "SKILL.md": "# 焚锋\n\n高压、短促、直接地反击低质量言论。",
      "style_profile.json": JSON.stringify({ tone: "direct", intensity: "high" }, null, 2),
      "attack_playbook.json": JSON.stringify({ tactics: ["指出预设", "压缩逻辑"] }, null, 2),
    },
    manifest: { builtin: true, quality: { seeded: true } },
    builtin: true,
  },
  {
    id: "restrained_breakdown",
    name: "静辨",
    goal: "克制地拆解观点漏洞。",
    summary: "适合保持礼貌但不让步的反驳。",
    version: "0.1.0",
    score: 76,
    confidence: "medium",
    compile_status: "builtin",
    source: "builtin",
    lineage: "extension-builtin",
    skill_md: "# 静辨\n\n克制地拆解观点漏洞。",
    sample_outputs: [{ prompt: "这没什么问题吧。", reply: "问题不在结论，而在你跳过了关键前提。" }],
    files: {
      "SKILL.md": "# 静辨\n\n克制地拆解观点漏洞。",
      "style_profile.json": JSON.stringify({ tone: "restrained", intensity: "medium" }, null, 2),
      "attack_playbook.json": JSON.stringify({ tactics: ["拆前提", "补证据"] }, null, 2),
    },
    manifest: { builtin: true, quality: { seeded: true } },
    builtin: true,
  },
  {
    id: "sarcastic_ironic",
    name: "冷讥",
    goal: "用讽刺和反问处理荒谬观点。",
    summary: "适合轻讽刺、反问式的候选。",
    version: "0.1.0",
    score: 70,
    confidence: "medium",
    compile_status: "builtin",
    source: "builtin",
    lineage: "extension-builtin",
    skill_md: "# 冷讥\n\n用讽刺和反问处理荒谬观点。",
    sample_outputs: [{ prompt: "你懂什么。", reply: "确实，我只懂把话说清楚这件小事。" }],
    files: {
      "SKILL.md": "# 冷讥\n\n用讽刺和反问处理荒谬观点。",
      "style_profile.json": JSON.stringify({ tone: "ironic", intensity: "medium" }, null, 2),
      "attack_playbook.json": JSON.stringify({ tactics: ["反问", "轻讽刺"] }, null, 2),
    },
    manifest: { builtin: true, quality: { seeded: true } },
    builtin: true,
  },
  {
    id: "skill_creator",
    name: "铸技司",
    goal: "根据素材箱生成新的 Skill 草稿。",
    summary: "Workbench 内部使用的 Skill 创建能力。",
    version: "0.1.0",
    score: 60,
    confidence: "low",
    compile_status: "builtin",
    source: "builtin",
    lineage: "extension-builtin",
    skill_md: "# 铸技司\n\n根据素材箱生成新的 Skill 草稿。",
    sample_outputs: [],
    files: {
      "SKILL.md": "# 铸技司\n\n根据素材箱生成新的 Skill 草稿。",
      "style_profile.json": JSON.stringify({ internal: true }, null, 2),
      "attack_playbook.json": JSON.stringify({ internal: true }, null, 2),
    },
    manifest: { builtin: true, internal: true },
    builtin: true,
  },
];

export function getBuiltinSkillDetails(): SkillDetail[] {
  return BUILTIN_SKILLS.map(({ builtin: _builtin, ...skill }) => ({ ...skill }));
}

export function getBuiltinSkillInfos(): SkillInfo[] {
  return getBuiltinSkillDetails().map(({ skill_md: _skillMd, sample_outputs: _samples, files: _files, manifest: _manifest, ...info }) => info);
}
