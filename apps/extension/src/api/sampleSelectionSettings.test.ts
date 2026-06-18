import { afterEach, describe, expect, it } from "vitest";
import { getSettings, resetExtensionDataForTests, saveSettings } from "./idbStore";

describe("sample selection settings", () => {
  afterEach(() => {
    resetExtensionDataForTests();
  });

  it("defaults sample selections to an empty object", async () => {
    expect((await getSettings()).skill_sample_selections).toEqual({});
  });

  it("persists sample selections without replacing other length buckets", async () => {
    await saveSettings({
      skill_sample_selections: {
        full_fire: {
          "短": "短-one",
          "中": "中-one",
        },
      },
    });

    expect((await getSettings()).skill_sample_selections).toEqual({
      full_fire: {
        "短": "短-one",
        "中": "中-one",
      },
    });
  });
});

