const INTERNAL_STRATEGY_LABELS = [
  "议题拆解",
  "因果识别",
  "因果追问",
  "因果链追问",
  "压缩结论",
  "定义战",
  "定义争夺",
  "分类",
  "归类",
  "反问",
  "类比",
  "反事实",
  "还原",
  "讽刺",
  "攻击路径",
  "策略步骤",
];

const INTERNAL_STRATEGY_LABEL_PATTERN = new RegExp(
  `(^|[\\r\\n。！？!?；;])\\s*(?:${INTERNAL_STRATEGY_LABELS.join("|")})\\s*[：:]\\s*`,
  "gu",
);

export const INTERNAL_STRATEGY_LABEL_OUTPUT_RULE =
  "内部策略标签（如议题拆解、因果识别、因果追问、压缩结论、定义战、分类等）只用于理解 Skill，不得出现在最终可见回复里；不要输出冒号式步骤名或分析小标题。";

export function stripVisibleInternalStrategyLabels(value: string): string {
  return value.replace(INTERNAL_STRATEGY_LABEL_PATTERN, "$1").trim();
}
