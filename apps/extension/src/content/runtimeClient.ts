import type { AmmoBoxOption, ClapbackSettings, GenerateRequest, GenerateResponse, RuntimeClient, SkillOption } from "./types";
import { sendContentMessage } from "./contentMessage";

const INTERNAL_WORKBENCH_SKILL_IDS = new Set(["skill_creator"]);

export const defaultSettings: ClapbackSettings = {
  activeSkillId: "full_fire",
  lengthMode: "短",
  ammoBoxIds: [],
};

export function runtimeSettings(settings: ClapbackSettings): ClapbackSettings {
  return { ...settings };
}

export function createRuntimeClient(_settings: ClapbackSettings = defaultSettings): RuntimeClient {
  return {
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      return sendContentMessage("generation:generateCandidates", request);
    },
    async openWorkbench(): Promise<void> {
      await sendContentMessage("workbench:open");
    },
    async listSkills(): Promise<SkillOption[]> {
      const items = await sendContentMessage("skills:list");
      return items
        .map((item) => ({ id: item.id, name: item.name }))
        .filter((item) => !INTERNAL_WORKBENCH_SKILL_IDS.has(item.id));
    },
    async listAmmoBoxes(): Promise<AmmoBoxOption[]> {
      const items = await sendContentMessage("ammo:listBoxes");
      return items.map((item) => ({ id: item.id, name: item.name }));
    },
  };
}
