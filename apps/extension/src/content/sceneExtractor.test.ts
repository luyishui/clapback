import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { extractZhihuScene } from "./sceneExtractor";

function loadFixture(name: string) {
  const html = fs.readFileSync(path.resolve("../../references/html", name), "utf8");
  document.documentElement.innerHTML = html;
}

describe("extractZhihuScene", () => {
  it("extracts loaded Zhihu comments with author and text", () => {
    loadFixture("知乎2.txt");

    const scene = extractZhihuScene(document);

    expect(scene.comments.length).toBeGreaterThan(0);
    expect(scene.comments[0].platform).toBe("zhihu");
    expect(scene.comments.some((comment) => comment.text.includes("废除了就举孝廉了"))).toBe(true);
    expect(scene.comments.some((comment) => comment.authorName === "SupppRabit")).toBe(true);
  });

  it("extracts question title from a Zhihu question page", () => {
    loadFixture("知乎3.txt");

    const scene = extractZhihuScene(document);

    expect(scene.pageTitle).toContain("被北大三次退档的河南考生");
  });
});
