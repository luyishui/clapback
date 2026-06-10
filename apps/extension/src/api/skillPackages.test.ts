import { describe, expect, it } from "vitest";
import { parseSkillPackageText } from "./skillPackages";

describe("Skill package parsing", () => {
  it("treats Markdown files as SKILL.md packages", () => {
    expect(parseSkillPackageText("# Markdown Skill\n\nUse this voice.", "voice.md")).toEqual({
      "SKILL.md": "# Markdown Skill\n\nUse this voice.",
    });
  });

  it("accepts raw JSON file maps", () => {
    expect(parseSkillPackageText(JSON.stringify({
      "SKILL.md": "# JSON Skill",
      "style_profile.json": "{\"tone\":\"dry\"}",
    }), "skill.json")).toEqual({
      "SKILL.md": "# JSON Skill",
      "style_profile.json": "{\"tone\":\"dry\"}",
    });
  });

  it("accepts JSON packages with a files object", () => {
    expect(parseSkillPackageText(JSON.stringify({
      files: {
        "SKILL.md": "# Wrapped Skill",
        "attack_playbook.json": "{}",
      },
    }), "package.json")).toEqual({
      "SKILL.md": "# Wrapped Skill",
      "attack_playbook.json": "{}",
    });
  });

  it("rejects invalid JSON package shapes", () => {
    expect(() => parseSkillPackageText(JSON.stringify({ files: ["SKILL.md"] }), "bad.json"))
      .toThrow("invalid_skill_package");
  });

  it("rejects executable files before import", () => {
    expect(() => parseSkillPackageText(JSON.stringify({
      files: {
        "SKILL.md": "# Bad Skill",
        "run.js": "alert(1)",
      },
    }), "bad.json")).toThrow("executable_skill_file");
  });
});
