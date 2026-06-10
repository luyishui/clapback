import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPanel } from "./buildPanel";
import { hydratePanelOptions, loadPanelOptions } from "./panelOptions";
import type { RuntimeClient } from "./types";

describe("panel option loading", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("filters internal workbench-only skills from the generation panel options", async () => {
    const runtime: RuntimeClient = {
      generate: vi.fn(),
      listSkills: vi.fn().mockResolvedValue([
        { id: "skill_creator", name: "Skill Creator" },
        { id: "full_fire", name: "Full Fire" },
      ]),
      listAmmoBoxes: vi.fn().mockResolvedValue([]),
    };

    await expect(loadPanelOptions(runtime)).resolves.toEqual({
      skills: [{ id: "full_fire", name: "Full Fire" }],
      ammoBoxes: [],
    });
  });

  it("uses the runtime default generation skill when saved settings point to a missing legacy skill", () => {
    const panel = buildPanel({
      targetText: "目标评论",
      settings: { activeSkillId: "default_high_fire", lengthMode: "短", ammoBoxIds: [] },
    });

    hydratePanelOptions(
      panel,
      { activeSkillId: "default_high_fire", lengthMode: "短", ammoBoxIds: [] },
      [
        { id: "restrained_breakdown", name: "Restrained Breakdown" },
        { id: "full_fire", name: "Full Fire" },
      ],
      [],
    );

    expect(panel.skillSelect.value).toBe("full_fire");
    expect([...panel.skillSelect.options].map((option) => option.value)).toEqual(["restrained_breakdown", "full_fire"]);
  });

  it("does not fabricate ammo boxes that were not returned by runtime", () => {
    const panel = buildPanel({
      targetText: "目标评论",
      settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [1, 2] },
      skills: [{ id: "full_fire", name: "Full Fire" }],
    });

    hydratePanelOptions(
      panel,
      { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [1, 2] },
      [{ id: "full_fire", name: "Full Fire" }],
      [{ id: 2, name: "热梗" }],
    );

    expect([...panel.ammoSelect.options].map((option) => option.value)).toEqual(["2"]);
    expect([...panel.ammoSelect.selectedOptions].map((option) => option.value)).toEqual(["2"]);
    expect(panel.getSettings().ammoBoxIds).toEqual([2]);
  });
});
