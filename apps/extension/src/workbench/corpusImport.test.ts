import { describe, expect, it } from "vitest";
import { parseCorpusImportText } from "./corpusImport";

describe("Corpus self-import parsing", () => {
  it("parses JSONL strings and object rows", () => {
    expect(parseCorpusImportText([
      JSON.stringify("第一段素材"),
      JSON.stringify({ text: "第二段素材", source: "zhihu", metadata: { url: "https://example.com/a" } }),
      JSON.stringify({ content: "第三段素材" }),
    ].join("\n"), "notes.jsonl")).toEqual([
      { source: "self-import", content: "第一段素材", metadata: {} },
      { source: "zhihu", content: "第二段素材", metadata: { url: "https://example.com/a" } },
      { source: "self-import", content: "第三段素材", metadata: {} },
    ]);
  });

  it("parses JSON arrays", () => {
    expect(parseCorpusImportText(JSON.stringify([
      "数组素材",
      { content: "对象素材", source: "manual" },
    ]), "entries.json")).toEqual([
      { source: "self-import", content: "数组素材", metadata: {} },
      { source: "manual", content: "对象素材", metadata: {} },
    ]);
  });

  it("parses JSON packages with entries", () => {
    expect(parseCorpusImportText(JSON.stringify({
      entries: [
        { text: "包内素材", metadata: { tag: "imported" } },
      ],
    }), "package.json")).toEqual([
      { source: "self-import", content: "包内素材", metadata: { tag: "imported" } },
    ]);
  });

  it("splits plain text and Markdown by blank lines", () => {
    expect(parseCorpusImportText("第一段\n还在第一段\n\n## 第二段\n\n第三段", "notes.md")).toEqual([
      { source: "self-import", content: "第一段\n还在第一段", metadata: {} },
      { source: "self-import", content: "## 第二段", metadata: {} },
      { source: "self-import", content: "第三段", metadata: {} },
    ]);
  });

  it("returns no entries for empty input", () => {
    expect(parseCorpusImportText(" \n \n", "empty.txt")).toEqual([]);
  });

  it("skips invalid rows while keeping valid JSONL rows", () => {
    expect(parseCorpusImportText([
      JSON.stringify({ content: "有效素材" }),
      JSON.stringify({ title: "缺少内容字段" }),
      "{not-json",
      JSON.stringify(42),
    ].join("\n"), "mixed.jsonl")).toEqual([
      { source: "self-import", content: "有效素材", metadata: {} },
    ]);
  });
});
