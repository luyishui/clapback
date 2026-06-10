import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendContentMessage } from "./contentMessage";

describe("content message client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
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

    await expect(sendContentMessage("extension:health")).resolves.toEqual({
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

    await expect(sendContentMessage("extension:health")).resolves.toEqual({
      ok: true,
      service: "clapback-extension",
      version: "0.1.0",
    });
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "extension:health", payload: undefined }, expect.any(Function));
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: "extension:health", payload: undefined });
  });
});
