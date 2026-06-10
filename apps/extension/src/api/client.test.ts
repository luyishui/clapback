import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendExtensionMessage } from "./client";

describe("extension API client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not bypass background handlers when chrome.runtime is unavailable", async () => {
    await expect(sendExtensionMessage("extension:health")).rejects.toThrow("extension_background_unavailable");
  });

  it("accepts callback-style runtime responses when Promise sendMessage is unavailable", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
          callback({ ok: true, data: { ok: true, service: "clapback-extension", version: "0.1.0" } });
          return undefined;
        }),
      },
    });

    await expect(sendExtensionMessage("extension:health")).resolves.toEqual({
      ok: true,
      service: "clapback-extension",
      version: "0.1.0",
    });
  });

  it("falls back to one-argument Promise sendMessage when callback arguments are rejected", async () => {
    const sendMessage = vi.fn(function (_message: unknown, callback?: (response: unknown) => void) {
      if (callback) throw new TypeError("callback argument unsupported");
      return Promise.resolve({ ok: true, data: { ok: true, service: "clapback-extension", version: "0.1.0" } });
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await expect(sendExtensionMessage("extension:health")).resolves.toEqual({
      ok: true,
      service: "clapback-extension",
      version: "0.1.0",
    });
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "extension:health", payload: undefined }, expect.any(Function));
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: "extension:health", payload: undefined });
  });
});
