import type { AmmoBoxOption, ClapbackSettings, SkillOption } from "./types";
import {
  CUSTOM_LENGTH_DEFAULT_TARGET,
  CUSTOM_LENGTH_MAX_CHARS,
  CUSTOM_LENGTH_MODE,
  sanitizeCustomLengthTarget,
} from "../api/lengthConstraints";

export type PanelHandle = {
  root: HTMLElement;
  intent: HTMLTextAreaElement;
  generate: HTMLButtonElement;
  candidates: HTMLElement;
  settingsPanel: HTMLElement;
  skillSelect: HTMLSelectElement;
  lengthSelect: HTMLSelectElement;
  customLengthInput: HTMLInputElement;
  ammoSelect: HTMLSelectElement;
  ammoChecklist: HTMLElement;
  close: HTMLButtonElement;
  getSettings(): ClapbackSettings;
  syncAmmoChecklist(): void;
};

export type BuildPanelOptions = {
  targetText: string;
  settings: ClapbackSettings;
  skills?: SkillOption[];
  ammoBoxes?: AmmoBoxOption[];
  onClose?: () => void;
};

const PEN_TOOL_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`;

export function buildPanel(options: BuildPanelOptions): PanelHandle {
  const skillOptions = normalizeSkills(options.settings.activeSkillId, options.skills);
  const ammoOptions = normalizeAmmoBoxes(options.settings.ammoBoxIds ?? [], options.ammoBoxes);
  const customLengthTarget = sanitizeCustomLengthTarget(options.settings.customLengthTarget) ?? CUSTOM_LENGTH_DEFAULT_TARGET;
  const root = document.createElement("section");
  root.className = "clapback-panel";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Clapback 宣纸浮签");

  root.innerHTML = `
    <header class="clapback-panel__header">
      <span class="clapback-panel__brand">嘴替</span>
      <button class="clapback-panel__close" type="button" aria-label="关闭">×</button>
    </header>
    <div class="clapback-panel__target">
      <span class="clapback-panel__target-label">目标已锁定，等待发散...</span>
      <p class="clapback-panel__target-content">${escapeHtml(options.targetText)}</p>
    </div>
    <textarea class="clapback-intent" rows="3" placeholder="输入内核..." aria-label="我想表达"></textarea>
    <div id="clapback-settings-summary" class="clapback-panel__settings">
      <label class="clapback-panel__field">
        <span>Skill</span>
        <select class="clapback-panel__select clapback-skill-select" aria-label="Skill">
          ${skillOptions.map((skill) => optionHtml(skill.id, skill.name ?? skill.id, skill.id === options.settings.activeSkillId)).join("")}
        </select>
      </label>
      <label class="clapback-panel__field">
        <span>目标字数</span>
        <input
          class="clapback-custom-length"
          type="number"
          min="1"
          max="${CUSTOM_LENGTH_MAX_CHARS}"
          step="1"
          value="${customLengthTarget}"
          aria-label="目标字数"
        >
      </label>
      <label class="clapback-panel__field clapback-panel__field--ammo">
        <span>弹药箱</span>
        <select class="clapback-panel__select clapback-ammo-select" aria-label="弹药箱" multiple hidden>
          ${ammoOptions.map((box) => optionHtml(String(box.id), box.name, (options.settings.ammoBoxIds ?? []).includes(box.id))).join("")}
        </select>
        <div class="clapback-ammo-checklist" role="group" aria-label="弹药箱">
          ${ammoOptions.map((box) => ammoCheckboxHtml(box, (options.settings.ammoBoxIds ?? []).includes(box.id))).join("")}
        </div>
      </label>
    </div>
    <div class="clapback-panel__actions">
      <button class="clapback-generate" type="button">${PEN_TOOL_SVG}<span>生成</span></button>
    </div>
    <p class="clapback-panel__hint">单击复制，双击填入</p>
    <div class="clapback-panel__candidates" aria-live="polite"></div>
  `;

  const intent = root.querySelector<HTMLTextAreaElement>(".clapback-intent")!;
  const generate = root.querySelector<HTMLButtonElement>(".clapback-generate")!;
  const candidates = root.querySelector<HTMLElement>(".clapback-panel__candidates")!;
  const settingsPanel = root.querySelector<HTMLElement>(".clapback-panel__settings")!;
  const skillSelect = root.querySelector<HTMLSelectElement>(".clapback-skill-select")!;
  const lengthSelect = document.createElement("select");
  const customLengthInput = root.querySelector<HTMLInputElement>(".clapback-custom-length")!;
  const ammoSelect = root.querySelector<HTMLSelectElement>(".clapback-ammo-select")!;
  const ammoChecklist = root.querySelector<HTMLElement>(".clapback-ammo-checklist")!;
  const close = root.querySelector<HTMLButtonElement>(".clapback-panel__close")!;

  bindAmmoChecklist(ammoSelect, ammoChecklist);

  close.addEventListener("click", () => {
    root.remove();
    options.onClose?.();
  });

  return {
    root,
    intent,
    generate,
    candidates,
    settingsPanel,
    skillSelect,
    lengthSelect,
    customLengthInput,
    ammoSelect,
    ammoChecklist,
    close,
    syncAmmoChecklist() {
      renderAmmoChecklist(ammoSelect, ammoChecklist);
    },
    getSettings() {
      const parsed = sanitizeCustomLengthTarget(customLengthInput.value);
      const settings: ClapbackSettings = {
        activeSkillId: skillSelect.value || options.settings.activeSkillId,
        lengthMode: CUSTOM_LENGTH_MODE,
        customLengthTarget: parsed ?? customLengthTarget,
        ammoBoxIds: [...ammoSelect.selectedOptions]
          .map((option) => Number(option.value))
          .filter((value) => Number.isInteger(value)),
      };
      return settings;
    },
  };
}

function normalizeSkills(activeSkillId: string, skills: SkillOption[] = []): SkillOption[] {
  const byId = new Map<string, SkillOption>();
  byId.set(activeSkillId, { id: activeSkillId, name: activeSkillId });
  skills.forEach((skill) => byId.set(skill.id, skill));
  return [...byId.values()];
}

function normalizeAmmoBoxes(selectedIds: number[], ammoBoxes: AmmoBoxOption[] = []): AmmoBoxOption[] {
  const byId = new Map<number, AmmoBoxOption>();
  ammoBoxes.forEach((box) => byId.set(box.id, box));
  return [...byId.values()];
}

function optionHtml(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function ammoCheckboxHtml(box: AmmoBoxOption, checked: boolean): string {
  const value = escapeHtml(String(box.id));
  return `
    <label class="clapback-ammo-check">
      <input class="clapback-ammo-checkbox" type="checkbox" value="${value}"${checked ? " checked" : ""}>
      <span>${escapeHtml(box.name)}</span>
    </label>
  `;
}

function bindAmmoChecklist(select: HTMLSelectElement, checklist: HTMLElement): void {
  checklist.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.classList.contains("clapback-ammo-checkbox")) return;
    const option = [...select.options].find((item) => item.value === input.value);
    if (option) option.selected = input.checked;
  });
}

function renderAmmoChecklist(select: HTMLSelectElement, checklist: HTMLElement): void {
  checklist.replaceChildren(
    ...[...select.options].map((option) => {
      const label = document.createElement("label");
      label.className = "clapback-ammo-check";
      const input = document.createElement("input");
      input.className = "clapback-ammo-checkbox";
      input.type = "checkbox";
      input.value = option.value;
      input.checked = option.selected;
      const span = document.createElement("span");
      span.textContent = option.textContent ?? option.value;
      label.append(input, span);
      return label;
    }),
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
