import { beforeEach, describe, expect, it } from "vitest";
import { buildPanel } from "../buildPanel";

describe("buildPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns a panel with the correct structure and class names", () => {
    const handle = buildPanel({
      targetText: "测试评论内容",
      settings: { activeSkillId: "默认高压嘴替", lengthMode: "短" },
    });

    expect(handle.root.tagName).toBe("SECTION");
    expect(handle.root.classList.contains("clapback-panel")).toBe(true);
    expect(handle.root.getAttribute("role")).toBe("dialog");
  });

  it("displays the brand header with 嘴替", () => {
    const handle = buildPanel({
      targetText: "测试",
      settings: { activeSkillId: "默认高压嘴替", lengthMode: "短" },
    });

    const brand = handle.root.querySelector(".clapback-panel__brand");
    expect(brand?.textContent).toBe("嘴替");
  });

  it("shows the locked target text", () => {
    const handle = buildPanel({
      targetText: "这是目标评论",
      settings: { activeSkillId: "默认高压嘴替", lengthMode: "短" },
    });

    expect(handle.root.textContent).toContain("目标已锁定");
    expect(handle.root.textContent).toContain("这是目标评论");
  });

  it("displays the skill selector with the active skill id", () => {
    const handle = buildPanel({
      targetText: "测试",
      settings: { activeSkillId: "我的嘴替", lengthMode: "中" },
    });

    expect(handle.skillSelect.value).toBe("我的嘴替");
    expect(handle.skillSelect.textContent).toContain("我的嘴替");
  });

  it("has a generate button containing 生成", () => {
    const handle = buildPanel({
      targetText: "测试",
      settings: { activeSkillId: "默认高压嘴替", lengthMode: "短" },
    });

    expect(handle.generate.textContent).toContain("生成");
  });

  it("shows skill, target length, and multi-select ammo controls without duplicate presets", () => {
    const handle = buildPanel({
      targetText: "测试",
      settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [1, 2] },
      skills: [{ id: "full_fire", name: "火力全开" }],
      ammoBoxes: [{ id: 2, name: "热梗" }],
    });

    expect(handle.settingsPanel.hidden).toBe(false);
    expect(handle.skillSelect.value).toBe("full_fire");
    expect([...handle.skillSelect.options].map((option) => option.value)).toEqual(["full_fire"]);
    expect(handle.root.querySelector(".clapback-length-select")).toBeNull();
    expect(handle.customLengthInput.hidden).toBe(false);
    expect(handle.customLengthInput.value).toBe("20");
    expect(handle.ammoSelect.hidden).toBe(true);
    expect([...handle.root.querySelectorAll<HTMLInputElement>(".clapback-ammo-checkbox")].map((option) => option.value)).toEqual(["2"]);
    expect([...handle.root.querySelectorAll<HTMLInputElement>(".clapback-ammo-checkbox:checked")].map((option) => option.value)).toEqual(["2"]);
    expect(handle.settingsPanel.textContent).toContain("Skill");
    expect(handle.settingsPanel.textContent).toContain("目标字数");
    expect(handle.settingsPanel.textContent).not.toContain("10字以内");
    expect(handle.settingsPanel.textContent).not.toContain("展开");
    expect(handle.settingsPanel.textContent).toContain("弹药箱");
  });

  it("returns current panel settings", () => {
    const handle = buildPanel({
      targetText: "测试",
      settings: { activeSkillId: "默认高压嘴替", lengthMode: "短", ammoBoxIds: [] },
      skills: [{ id: "full_fire", name: "火力全开" }],
      ammoBoxes: [{ id: 7, name: "法律常识" }, { id: 9, name: "热梗" }],
    });

    handle.skillSelect.value = "full_fire";
    handle.customLengthInput.value = "50";
    const ammoChecks = handle.root.querySelectorAll<HTMLInputElement>(".clapback-ammo-checkbox");
    ammoChecks[0].checked = true;
    ammoChecks[0].dispatchEvent(new Event("change", { bubbles: true }));
    ammoChecks[1].checked = true;
    ammoChecks[1].dispatchEvent(new Event("change", { bubbles: true }));

    expect(handle.getSettings()).toEqual({
      activeSkillId: "full_fire",
      lengthMode: "自定义",
      customLengthTarget: 50,
      ammoBoxIds: [7, 9],
    });
  });

  it("returns a custom target length from the always-visible target input", () => {
    const handle = buildPanel({
      targetText: "测试",
      settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 18, ammoBoxIds: [] },
      skills: [{ id: "full_fire", name: "火力全开" }],
    });

    expect(handle.customLengthInput.hidden).toBe(false);
    expect(handle.customLengthInput.value).toBe("18");

    handle.customLengthInput.value = "24";

    expect(handle.getSettings()).toEqual({
      activeSkillId: "full_fire",
      lengthMode: "自定义",
      customLengthTarget: 24,
      ammoBoxIds: [],
    });
  });

  it("close button removes the panel from DOM", () => {
    const handle = buildPanel({
      targetText: "测试",
      settings: { activeSkillId: "默认高压嘴替", lengthMode: "短" },
    });

    document.body.append(handle.root);
    expect(document.querySelector(".clapback-panel")).not.toBeNull();

    handle.close.click();
    expect(document.querySelector(".clapback-panel")).toBeNull();
  });

  it("escapes HTML in target text to prevent XSS", () => {
    const handle = buildPanel({
      targetText: '<script>alert("xss")</script>',
      settings: { activeSkillId: "默认高压嘴替", lengthMode: "短" },
    });

    expect(handle.root.innerHTML).not.toContain("<script>");
    expect(handle.root.textContent).toContain('<script>alert("xss")</script>');
  });
});
