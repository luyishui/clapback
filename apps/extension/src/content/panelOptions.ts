import { buildPanel } from "./buildPanel";
import type { AmmoBoxOption, ClapbackSettings, RuntimeClient, SkillOption } from "./types";

const DEFAULT_GENERATION_SKILL_ID = "full_fire";
const INTERNAL_WORKBENCH_SKILL_IDS = new Set(["skill_creator"]);

export async function loadPanelOptions(runtime: RuntimeClient): Promise<{ skills: SkillOption[]; ammoBoxes: AmmoBoxOption[] }> {
  const [skills, ammoBoxes] = await Promise.all([
    runtime.listSkills?.().catch(() => []) ?? Promise.resolve([]),
    runtime.listAmmoBoxes?.().catch(() => []) ?? Promise.resolve([]),
  ]);
  return { skills: skills.filter(isGenerationSkill), ammoBoxes };
}

export function hydratePanelOptions(
  panel: ReturnType<typeof buildPanel>,
  settings: ClapbackSettings,
  skills: SkillOption[],
  ammoBoxes: AmmoBoxOption[],
): void {
  const generationSkills = skills.filter(isGenerationSkill);
  replaceSelectOptions(panel.skillSelect, generationSkills, resolveSelectedSkillId(settings.activeSkillId, generationSkills));
  replaceSelectOptions(panel.ammoSelect, ammoBoxes, settings.ammoBoxIds ?? []);
  panel.syncAmmoChecklist();
}

function isGenerationSkill(skill: SkillOption): boolean {
  return !INTERNAL_WORKBENCH_SKILL_IDS.has(skill.id);
}

function resolveSelectedSkillId(activeSkillId: string, skills: SkillOption[]): string {
  if (skills.some((skill) => skill.id === activeSkillId)) return activeSkillId;
  if (skills.some((skill) => skill.id === DEFAULT_GENERATION_SKILL_ID)) return DEFAULT_GENERATION_SKILL_ID;
  return skills[0]?.id ?? activeSkillId;
}

function replaceSelectOptions(
  select: HTMLSelectElement,
  options: Array<{ id: string | number; name?: string }>,
  selected: string | number | Array<string | number>,
): void {
  const selectedValues = new Set((Array.isArray(selected) ? selected : [selected]).map(String));
  const seen = new Set<string>();
  select.replaceChildren(
    ...options
      .filter((option) => {
        const id = String(option.id);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((option) => {
        const element = document.createElement("option");
        element.value = String(option.id);
        element.textContent = option.name ?? String(option.id);
        element.selected = selectedValues.has(element.value);
        return element;
      }),
  );
}
