import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type ExtensionManifest = {
  content_scripts?: Array<{ js?: string[] }>;
};

describe("extension distribution", () => {
  it("ships manifest content scripts as self-contained classic scripts", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "dist", "manifest.json"), "utf8"),
    ) as ExtensionManifest;
    const contentScripts = (manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []);

    expect(contentScripts.length).toBeGreaterThan(0);
    for (const scriptPath of contentScripts) {
      const source = readFileSync(join(process.cwd(), "dist", scriptPath), "utf8").trimStart();
      expect(source).not.toMatch(/^(?:import|export)\b/m);
    }
  });
});
