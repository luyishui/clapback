import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeClient, defaultSettings } from "./runtimeClient";

describe("extension content client", () => {
  const sendMessage = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    sendMessage.mockReset();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
  });

  it("defaults daily generation to a real built-in generation skill", () => {
    expect(defaultSettings.activeSkillId).toBe("full_fire");
    expect("runtimeBaseUrl" in defaultSettings).toBe(false);
  });

  it("lists only skills that can be used for daily generation through background messaging", async () => {
    sendMessage.mockResolvedValueOnce({
      ok: true,
      data: [
        { id: "restrained_breakdown", name: "Restrained Breakdown" },
        { id: "sarcastic_ironic", name: "Sarcastic Ironic" },
        { id: "full_fire", name: "Full Fire" },
        { id: "skill_creator", name: "Skill Creator" },
        { id: "my_voice", name: "My Voice" },
      ],
    });

    const client = createRuntimeClient({
      activeSkillId: "full_fire",
      lengthMode: "短",
    });

    await expect(client.listSkills?.()).resolves.toEqual([
      { id: "restrained_breakdown", name: "Restrained Breakdown" },
      { id: "sarcastic_ironic", name: "Sarcastic Ironic" },
      { id: "full_fire", name: "Full Fire" },
      { id: "my_voice", name: "My Voice" },
    ]);
    expect(sendMessage).toHaveBeenCalledWith(
      { type: "skills:list", payload: undefined },
      expect.any(Function),
    );
  });

  it("sends extension generate requests to the background generation API", async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, data: { candidates: ["一", "二", "三"] } });

    const client = createRuntimeClient({
      activeSkillId: "精准反驳",
      lengthMode: "20字以内",
      ammoBoxIds: [7, 9],
    });

    await client.generate({
      platform: "zhihu",
      target: {
        id: "root-1",
        text: "这类 AI 回复工具只会让讨论更糟。",
      },
      context: {
        pageTitle: "如何看待嘴替这个产品？",
        nearbyComments: ["如果能保持不自动发布，我倒觉得可以试试。"],
      },
      intent: "反驳工具原罪",
      settings: {
        activeSkillId: "精准反驳",
        lengthMode: "20字以内",
        ammoBoxIds: [7, 9],
      },
    });

    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: "generation:generateCandidates",
        payload: expect.objectContaining({
          platform: "zhihu",
          target: { id: "root-1", text: "这类 AI 回复工具只会让讨论更糟。" },
          settings: { activeSkillId: "精准反驳", lengthMode: "20字以内", ammoBoxIds: [7, 9] },
        }),
      },
      expect.any(Function),
    );
  });

  it("returns all background candidates so the adapter can validate cardinality", async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, data: { candidates: ["一", "二", "三", "四"] } });

    const client = createRuntimeClient({
      activeSkillId: "精准反驳",
      lengthMode: "短",
    });

    const response = await client.generate({
      platform: "zhihu",
      target: {
        id: "root-1",
        text: "原评论",
      },
      context: {
        pageTitle: "页面标题",
        nearbyComments: [],
      },
      intent: "",
      settings: {
        activeSkillId: "精准反驳",
        lengthMode: "短",
      },
    });

    expect(response.candidates).toEqual(["一", "二", "三", "四"]);
  });

  it("opens the Workbench through the background API", async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, data: undefined });

    const client = createRuntimeClient(defaultSettings);

    await expect(client.openWorkbench?.()).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledWith(
      { type: "workbench:open", payload: undefined },
      expect.any(Function),
    );
  });
});
