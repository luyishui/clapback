/**
 * 生成阶段的轻量水墨动效覆盖层(纯 DOM,无 React)。
 *
 * 三种状态,对应 design.md §8 "ink spreading on paper, but fast":
 *  - "ink"   起墨中:墨滴 + 同心圆晕染扩散(不是大型 spinner)
 *  - "seal"  封笔中:印章红方章按下(150ms 过渡,生成返回结果前)
 *
 * 另提供 revealCandidates():给已渲染的 .clapback-candidate 子元素
 * 加 stagger 逐条淡入上滑(design.md §8 "Candidate row reveal")。
 *
 * 样式 / @keyframes 定义在 contentStyles.ts 的 CONTENT_CSS 中,
 * 通过运行时注入的 <style> 生效(内容脚本无法直接打包 CSS)。
 *
 * 降级:所有动画 keyframes 在 @media (prefers-reduced-motion: reduce)
 * 下被 contentStyles.ts 的全局守护规则强制瞬时(design.md §8)。
 */

export type InkStage = "ink" | "seal";

/**
 * 在候选容器内注入一个加载 overlay,替换原 "起墨中..." 纯文本。
 * 调用方在点击"生成"后立即调用,stage = "ink";
 * 生成返回结果前(~150ms)可再调用 stage = "seal"。
 */
export function showInkLoading(container: HTMLElement, stage: InkStage): void {
  container.replaceChildren();

  const overlay = document.createElement("div");
  overlay.className = `clapback-ink-loading clapback-ink-loading--${stage}`;
  overlay.setAttribute("aria-live", "polite");

  if (stage === "ink") {
    // 起墨中:3 圈错峰晕染 + 毛笔字文字
    overlay.innerHTML = `
      <div class="clapback-ink-loading__visual" aria-hidden="true">
        <span class="clapback-ink-ring clapback-ink-ring--1"></span>
        <span class="clapback-ink-ring clapback-ink-ring--2"></span>
        <span class="clapback-ink-ring clapback-ink-ring--3"></span>
        <span class="clapback-ink-drop"></span>
      </div>
      <span class="clapback-ink-loading__text">起墨中</span>
    `;
  } else {
    // 封笔中:印章红方章按下 + 文字
    overlay.innerHTML = `
      <div class="clapback-ink-loading__visual" aria-hidden="true">
        <span class="clapback-seal-stamp">封</span>
      </div>
      <span class="clapback-ink-loading__text">封笔中</span>
    `;
  }

  container.append(overlay);
}

/**
 * 给容器内已渲染的 .clapback-candidate 行加 stagger 逐条 reveal。
 * 由调用方在各站点的 renderCandidates(...) 之后调用。
 *
 * 行已具备完整功能(复制/填入),这里只负责入场动效;
 * 无 JS 动画库,用 CSS animation-delay 实现 stagger,reduced-motion 下自动失效。
 */
export function revealCandidates(container: HTMLElement): void {
  const rows = container.querySelectorAll<HTMLElement>(".clapback-candidate");
  rows.forEach((row, index) => {
    // 每条 40ms 错峰,符合 design.md §8 candidate row reveal
    row.style.animationDelay = `${index * 40}ms`;
    row.classList.add("clapback-candidate--reveal");
  });
}

/**
 * 在生成返回结果前展示"封笔中"印章过渡。
 * 返回一个 ~150ms 后 resolve 的 Promise,调用方可 await 后再 renderCandidates。
 * 不改变生成流程本身,只是前端的短暂过渡。
 */
export function flashSealStage(container: HTMLElement): Promise<void> {
  showInkLoading(container, "seal");
  return new Promise((resolve) => setTimeout(resolve, 150));
}
