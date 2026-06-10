export type CorpusImportEntry = {
  source: string;
  content: string;
  metadata: Record<string, unknown>;
};

const DEFAULT_SOURCE = "self-import";

export function parseCorpusImportText(text: string, fileName = "pasted.txt"): CorpusImportEntry[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const trimmed = normalized.trim();
  if (!trimmed) return [];

  if (/\.(?:jsonl)$/i.test(fileName)) {
    return parseJsonLines(normalized);
  }

  if (/\.(?:json)$/i.test(fileName)) {
    return parseJsonContainer(trimmed);
  }

  const jsonEntries = parseJsonContainer(trimmed);
  if (jsonEntries.length > 0) return jsonEntries;

  const jsonLineEntries = parseJsonLines(normalized);
  if (jsonLineEntries.length > 0 && normalized.split("\n").some(looksLikeJsonLine)) {
    return jsonLineEntries;
  }

  return normalized
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((content) => ({ source: DEFAULT_SOURCE, content, metadata: {} }));
}

function parseJsonContainer(text: string): CorpusImportEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  const items = Array.isArray(parsed)
    ? parsed
    : isPlainObject(parsed) && Array.isArray(parsed.entries)
      ? parsed.entries
      : [];
  return items.flatMap(toImportEntry);
}

function parseJsonLines(text: string): CorpusImportEntry[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return toImportEntry(JSON.parse(line));
      } catch {
        return [];
      }
    });
}

function toImportEntry(value: unknown): CorpusImportEntry[] {
  if (typeof value === "string") {
    const content = value.trim();
    return content ? [{ source: DEFAULT_SOURCE, content, metadata: {} }] : [];
  }

  if (!isPlainObject(value)) return [];
  const contentValue = typeof value.content === "string"
    ? value.content
    : typeof value.text === "string"
      ? value.text
      : "";
  const content = contentValue.trim();
  if (!content) return [];

  return [{
    source: typeof value.source === "string" && value.source.trim() ? value.source.trim() : DEFAULT_SOURCE,
    content,
    metadata: isPlainObject(value.metadata) ? { ...value.metadata } : {},
  }];
}

function looksLikeJsonLine(line: string): boolean {
  return /^[\s"'[{]/.test(line);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
