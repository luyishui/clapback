import { describe, expect, it, vi } from "vitest";
import { initializeContent } from "./main";

describe("content bootstrap", () => {
  it("keeps platform triggers loaded when collection toolbar cannot reach the background", async () => {
    const attachZhihuClapback = vi.fn();
    const injectGlobalTrigger = vi.fn();
    const attachCollectionToolbar = vi.fn().mockRejectedValue(new Error("extension_background_unavailable"));

    initializeContent({
      host: "www.zhihu.com",
      attachZhihuClapback,
      attachWeiboClapback: vi.fn(),
      attachXiaohongshuClapback: vi.fn(),
      injectGlobalTrigger,
      attachCollectionToolbar,
    });
    await Promise.resolve();

    expect(attachZhihuClapback).toHaveBeenCalledTimes(1);
    expect(injectGlobalTrigger).toHaveBeenCalledTimes(1);
    expect(attachCollectionToolbar).toHaveBeenCalledTimes(1);
  });
});
