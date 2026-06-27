export function injectContentStyles(): void {
  if (document.getElementById("clapback-content-style")) return;

  const style = document.createElement("style");
  style.id = "clapback-content-style";
  style.textContent = CONTENT_CSS;
  document.head.append(style);
}

const CONTENT_CSS = `
  .clapback-trigger,
  .clapback-panel {
    --clapback-ink-focus: #1a1a1a;
    --clapback-ink-dense: #333333;
    --clapback-ink-light: #666666;
    --clapback-ink-clear: #999999;
    --clapback-paper-xuan: #F8F5F0;
    --clapback-paper-rice: #FAF0E6;
    --clapback-paper-ivory: #FFFFF0;
    --clapback-seal-red: #C41E3A;
    --clapback-mountain-green: #2E8B57;
    --clapback-line-ink: rgba(26, 26, 26, 0.16);
    --clapback-shadow-paper: 0 12px 36px rgba(26, 26, 26, 0.12);
    --clapback-motion-fast: 150ms;
    --clapback-motion-base: 220ms;
    --clapback-motion-slow: 300ms;
  }

  @media (prefers-color-scheme: dark) {
    .clapback-trigger,
    .clapback-panel {
      --clapback-ink-focus: #E6DFD1;
      --clapback-ink-dense: #C9BEAD;
      --clapback-ink-light: #8A8278;
      --clapback-ink-clear: #6A6258;
      --clapback-paper-xuan: #181818;
      --clapback-paper-rice: #2A2A2A;
      --clapback-paper-ivory: #232220;
      --clapback-seal-red: #E0475F;
      --clapback-mountain-green: #6FBE8E;
      --clapback-line-ink: rgba(248, 245, 240, 0.22);
      --clapback-shadow-paper: 0 16px 42px rgba(0, 0, 0, 0.36);
    }
  }

  .clapback-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 0 4px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--clapback-seal-red);
    font-family: "Liu Jian Mao Cao", cursive;
    font-size: 15px;
    font-weight: normal;
    letter-spacing: 0;
    line-height: inherit;
    box-shadow: none;
    cursor: pointer;
    flex: 0 0 auto;
    white-space: nowrap;
    vertical-align: middle;
    transition: color 150ms ease,
                opacity 150ms ease;
  }

  .clapback-trigger:hover,
  .clapback-trigger:focus-visible {
    color: #8F1328;
    outline: none;
  }

  .clapback-trigger--zhihu {
    margin-left: 16px;
    line-height: 1;
    transform: translateY(-1px);
  }

  .clapback-trigger--stamp {
    min-height: 0;
    margin-left: 8px;
    padding: 0 2px;
    border: 0;
    border-radius: 0;
    background: transparent;
    line-height: 1;
  }

  .clapback-trigger--stamp:hover,
  .clapback-trigger--stamp:focus-visible {
    background: transparent;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .clapback-panel {
    width: 420px;
    max-width: calc(100vw - 32px);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border: 1px solid var(--clapback-ink-clear);
    border-radius: 12px;
    background: var(--clapback-paper-xuan);
    color: var(--clapback-ink-focus);
    font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "Microsoft YaHei", serif;
    font-size: 14px;
    line-height: 1.55;
    box-shadow: var(--clapback-shadow-paper);
    box-sizing: border-box;
    position: relative;
    z-index: 2147483646;
  }

  .clapback-panel--compact {
    width: 390px;
    padding: 20px;
    gap: 12px;
  }

  .clapback-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .clapback-panel__header-actions {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex: 0 0 auto;
  }

  .clapback-panel__workbench {
    min-height: 32px;
    padding: 0 12px;
    border: 1px solid var(--clapback-line-ink);
    border-radius: 8px;
    background: rgba(255, 255, 240, 0.72);
    color: var(--clapback-ink-dense);
    font-family: "Noto Serif SC", "Microsoft YaHei", serif;
    font-size: 12px;
    cursor: pointer;
    transition:
      border-color var(--clapback-motion-fast) ease,
      color var(--clapback-motion-fast) ease,
      background var(--clapback-motion-fast) ease;
  }

  .clapback-panel__workbench:hover,
  .clapback-panel__workbench:focus-visible {
    border-color: var(--clapback-seal-red);
    background: var(--clapback-paper-rice);
    color: var(--clapback-seal-red);
    outline: none;
  }

  .clapback-panel__brand {
    font-family: "Liu Jian Mao Cao", cursive;
    font-size: 52px;
    font-weight: normal;
    color: var(--clapback-seal-red);
    line-height: 1;
  }

  .clapback-panel--compact .clapback-panel__brand {
    font-size: 42px;
  }

  .clapback-panel__close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--clapback-ink-light);
    font-size: 18px;
    cursor: pointer;
  }

  .clapback-panel__close:hover {
    background: var(--clapback-paper-rice);
    color: var(--clapback-ink-focus);
  }
  .clapback-panel__target {
    padding: 16px;
    background: var(--clapback-paper-rice);
    border: 1px solid var(--clapback-ink-clear);
    border-radius: 8px;
  }

  .clapback-panel__target-label {
    display: block;
    color: var(--clapback-ink-light);
    font-size: 13px;
    margin-bottom: 4px;
  }

  .clapback-panel__target-content {
    margin: 0;
    color: var(--clapback-ink-dense);
    font-size: 14px;
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .clapback-intent {
    box-sizing: border-box;
    width: 100%;
    min-height: 80px;
    padding: 12px;
    border: 1px solid var(--clapback-ink-clear);
    border-radius: 8px;
    background: var(--clapback-paper-ivory);
    color: var(--clapback-ink-focus);
    font-family: inherit;
    font-size: 14px;
    resize: vertical;
  }

  .clapback-panel--compact .clapback-intent {
    min-height: 52px;
  }

  .clapback-intent::placeholder {
    color: var(--clapback-ink-light);
  }

  .clapback-intent:focus {
    border-color: var(--clapback-seal-red);
    box-shadow: 0 0 0 3px rgba(196, 30, 58, 0.10);
    outline: none;
  }

  .clapback-panel__actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
  }

  .clapback-skill-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border: 1px solid var(--clapback-line-ink);
    border-radius: 8px;
    background: transparent;
    color: var(--clapback-ink-dense);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .clapback-skill-chip:hover {
    background: var(--clapback-paper-rice);
  }

  .clapback-generate {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 8px 20px;
    border: 1px solid rgba(143, 19, 40, 0.24);
    border-radius: 8px;
    background: var(--clapback-seal-red);
    color: #ffffff;
    font-family: inherit;
    font-size: 14px;
    font-weight: normal;
    cursor: pointer;
    box-shadow: 0 8px 18px rgba(196, 30, 58, 0.22);
    transition: box-shadow var(--clapback-motion-base) cubic-bezier(0.22, 0.61, 0.36, 1);
  }

  .clapback-generate:hover {
    box-shadow: 0 0 0 4px rgba(196, 30, 58, 0.12),
                0 8px 18px rgba(196, 30, 58, 0.22);
  }

  .clapback-generate:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .clapback-generate svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .clapback-panel__hint {
    margin: 0;
    color: var(--clapback-ink-light);
    font-size: 12px;
  }

  .clapback-panel__candidates {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .clapback-candidate {
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid var(--clapback-line-ink);
    border-radius: 8px;
    background: rgba(255, 255, 240, 0.78);
    color: var(--clapback-ink-dense);
    font-family: inherit;
    font-size: 14px;
    text-align: left;
    line-height: 1.5;
    cursor: pointer;
    transition: border-color var(--clapback-motion-fast) ease;
  }

  .clapback-candidate:hover,
  .clapback-candidate:focus-visible {
    border-color: var(--clapback-seal-red);
    outline: none;
  }

  /* === 生成阶段动效(起墨中 / 封笔中) ===
     design.md §8: ink spreading on paper, but fast; no large spinner.
     所有 keyframes 在 @media (prefers-reduced-motion: reduce) 下被
     文件末尾的全局守护规则强制瞬时(design.md §8 / a11y CRITICAL)。 */

  .clapback-ink-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 16px 8px;
    color: var(--clapback-ink-light);
  }

  .clapback-ink-loading__visual {
    position: relative;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* —— 起墨中:墨滴 + 3 圈错峰晕染扩散 —— */
  .clapback-ink-ring {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid var(--clapback-ink-focus);
    opacity: 0;
    animation: clapback-ink-ripple 1.6s var(--clapback-ink-ease, cubic-bezier(0.16, 1, 0.3, 1)) infinite;
  }

  .clapback-ink-ring--1 { animation-delay: 0s; }
  .clapback-ink-ring--2 { animation-delay: 0.5s; }
  .clapback-ink-ring--3 { animation-delay: 1s; }

  .clapback-ink-drop {
    position: relative;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--clapback-ink-focus);
    animation: clapback-ink-pulse 1.6s cubic-bezier(0.45, 0, 0.55, 1) infinite;
  }

  @keyframes clapback-ink-ripple {
    0%   { transform: scale(0.6); opacity: 0; }
    20%  { opacity: 0.5; }
    100% { transform: scale(2.6); opacity: 0; }
  }

  @keyframes clapback-ink-pulse {
    0%, 100% { transform: scale(1); opacity: 0.85; }
    50%      { transform: scale(0.7); opacity: 1; }
  }

  /* —— 封笔中:印章红方章按下(150ms,--ease-seal 顿挫) —— */
  .clapback-seal-stamp {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 2px solid var(--clapback-seal-red);
    border-radius: 4px;
    background: var(--clapback-seal-red);
    color: #ffffff;
    font-family: "Liu Jian Mao Cao", "Ma Shan Zheng", cursive;
    font-size: 18px;
    line-height: 1;
    box-shadow: 0 2px 6px rgba(196, 30, 58, 0.35);
    transform-origin: center;
    animation: clapback-seal-stamp 150ms cubic-bezier(0.2, 0, 0, 1) both;
  }

  @keyframes clapback-seal-stamp {
    0%   { transform: scale(1.5) rotate(-6deg); opacity: 0; }
    60%  { transform: scale(0.94) rotate(1.5deg); opacity: 1; }
    100% { transform: scale(1) rotate(0deg); opacity: 1; }
  }

  .clapback-ink-loading__text {
    font-family: "Ma Shan Zheng", "Zhi Mang Xing", cursive;
    font-size: 15px;
    color: var(--clapback-ink-dense);
    letter-spacing: 0.1em;
  }

  /* —— 候选结果逐条 reveal(stagger) ——
     revealCandidates() 给每条 .clapback-candidate 加本类 + animation-delay。
     入场:淡入 + 轻微上滑(design.md §8 --motion-base --ease-brush)。 */
  .clapback-candidate--reveal {
    opacity: 0;
    animation: clapback-candidate-reveal 220ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
  }

  @keyframes clapback-candidate-reveal {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* —— 全局 reduced-motion 守护:生成动效全部瞬时降级 —— */
  @media (prefers-reduced-motion: reduce) {
    .clapback-ink-ring,
    .clapback-ink-drop,
    .clapback-seal-stamp,
    .clapback-candidate--reveal {
      animation-duration: 1ms !important;
      animation-iteration-count: 1 !important;
      animation-delay: 0ms !important;
      opacity: 1 !important;
      transform: none !important;
    }
  }

  .clapback-panel__settings {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(96px, 0.6fr);
    gap: 10px;
  }

  .clapback-panel__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .clapback-panel__field span {
    color: var(--clapback-ink-light);
    font-size: 12px;
  }

  .clapback-panel__field--ammo {
    grid-column: 1 / -1;
  }

  .clapback-panel__select {
    appearance: none;
    width: 100%;
    min-height: 34px;
    padding: 6px 28px 6px 8px;
    border: 1px solid var(--clapback-line-ink);
    border-radius: 8px;
    background-color: var(--clapback-paper-ivory);
    background-image:
      linear-gradient(45deg, transparent 50%, var(--clapback-ink-light) 50%),
      linear-gradient(135deg, var(--clapback-ink-light) 50%, transparent 50%),
      linear-gradient(135deg, var(--clapback-paper-ivory), var(--clapback-paper-xuan));
    background-position:
      calc(100% - 15px) 50%,
      calc(100% - 10px) 50%,
      0 0;
    background-size:
      5px 5px,
      5px 5px,
      100% 100%;
    background-repeat: no-repeat;
    color: var(--clapback-ink-focus);
    font-family: inherit;
    font-size: 13px;
    box-sizing: border-box;
  }

  .clapback-custom-length {
    appearance: textfield;
    width: 100%;
    min-height: 34px;
    padding: 6px 8px;
    border: 1px solid var(--clapback-line-ink);
    border-radius: 8px;
    background: var(--clapback-paper-ivory);
    color: var(--clapback-ink-focus);
    font-family: inherit;
    font-size: 13px;
    box-sizing: border-box;
  }

  .clapback-custom-length::-webkit-inner-spin-button,
  .clapback-custom-length::-webkit-outer-spin-button {
    appearance: none;
    margin: 0;
  }

  .clapback-custom-length[hidden] {
    display: none;
  }

  .clapback-ammo-select {
    min-height: 0;
  }

  .clapback-ammo-checklist {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .clapback-ammo-check {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    min-height: 28px;
    padding: 4px 8px;
    border: 1px solid var(--clapback-line-ink);
    border-radius: 8px;
    background: var(--clapback-paper-ivory);
    color: var(--clapback-ink-dense);
    font-size: 12px;
    cursor: pointer;
    box-sizing: border-box;
  }

  .clapback-ammo-check input {
    appearance: none;
    display: inline-grid;
    place-content: center;
    width: 14px;
    height: 14px;
    margin: 0;
    border: 1px solid var(--clapback-line-ink);
    border-radius: 4px;
    background: var(--clapback-paper-xuan);
    color: var(--clapback-seal-red);
    flex: 0 0 auto;
  }

  .clapback-ammo-check input:checked {
    border-color: var(--clapback-seal-red);
    background: var(--clapback-seal-red);
  }

  .clapback-ammo-check input:checked::after {
    content: "";
    width: 7px;
    height: 4px;
    border: solid #ffffff;
    border-width: 0 0 2px 2px;
    transform: rotate(-45deg) translateY(-1px);
  }

  .clapback-ammo-check input:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(196, 30, 58, 0.14);
  }

  .clapback-ammo-check span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clapback-panel__select:focus,
  .clapback-custom-length:focus {
    border-color: var(--clapback-seal-red);
    box-shadow: 0 0 0 3px rgba(196, 30, 58, 0.10);
    outline: none;
  }

  @media (max-width: 767px) {
    .clapback-panel {
      position: fixed !important;
      right: 16px !important;
      bottom: 16px !important;
      left: 16px !important;
      top: auto !important;
      width: auto !important;
      max-height: 82vh;
      overflow: auto;
    }
  }
`;
