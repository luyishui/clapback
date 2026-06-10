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

  .clapback-custom-length {
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
    margin: 0;
    accent-color: var(--clapback-seal-red);
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
