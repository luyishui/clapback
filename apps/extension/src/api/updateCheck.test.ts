import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, isVersionGreater, stripVersionPrefix } from "./updateCheck";

describe("extension update checks", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("chrome", {
      runtime: {
        getManifest: () => ({ version: "0.1.0" }),
      },
    });
  });

  it("compares semantic versions including prerelease precedence", () => {
    expect(stripVersionPrefix("v0.2.0")).toBe("0.2.0");
    expect(isVersionGreater("0.2.0", "0.1.9")).toBe(true);
    expect(isVersionGreater("1.2.3", "1.2.3-beta.1")).toBe(true);
    expect(isVersionGreater("1.2.3-beta.2", "1.2.3")).toBe(false);
    expect(isVersionGreater("1.2.3-beta.2", "1.2.3-beta.1")).toBe(true);
  });

  it("returns GitHub latest release metadata and download mirrors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      tag_name: "v0.2.0",
      html_url: "https://github.com/luyishui/clapback/releases/tag/v0.2.0",
      body: "Release notes",
    }), { status: 200 })));

    const result = await checkForUpdate();

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      hasUpdate: true,
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      tagName: "v0.2.0",
      releaseUrl: "https://github.com/luyishui/clapback/releases/tag/v0.2.0",
      releaseNotes: "Release notes",
      source: "github-api",
    }));
    expect(result.ok && result.mirrors[0].url).toBe(
      "https://github.com/luyishui/clapback/releases/download/v0.2.0/clapback-extension-v0.2.0.zip",
    );
  });

  it("falls back to a manifest source when GitHub latest is unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "0.2.0" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkForUpdate();

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      hasUpdate: true,
      latestVersion: "0.2.0",
      source: "jsdelivr-testingcf",
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a graceful error when all update sources fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));

    await expect(checkForUpdate()).resolves.toEqual({
      ok: false,
      error: "update_check_all_sources_failed",
    });
  });
});
