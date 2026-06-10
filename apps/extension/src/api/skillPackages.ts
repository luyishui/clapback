const EXECUTABLE_SKILL_FILE_PATTERN = /\.(?:py|js|mjs|cjs|ts|tsx|jsx|exe|bat|cmd|ps1|sh)$/i;

export async function parseSkillPackageFile(file: File): Promise<Record<string, string>> {
  return parseSkillPackageText(await readFileText(file), file.name);
}

export function parseSkillPackageText(text: string, fileName: string): Record<string, string> {
  if (/\.(?:md|markdown)$/i.test(fileName)) {
    return validateSkillFiles({ "SKILL.md": text });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid_skill_package");
  }

  const files = isStringRecord(parsed)
    ? parsed
    : isPlainObject(parsed) && isStringRecord(parsed.files)
      ? parsed.files
      : null;
  if (!files) throw new Error("invalid_skill_package");
  return validateSkillFiles(files);
}

export function findExecutableSkillFiles(files: Record<string, string>): string[] {
  return Object.keys(files).filter((name) => EXECUTABLE_SKILL_FILE_PATTERN.test(name));
}

function validateSkillFiles(files: Record<string, string>): Record<string, string> {
  const rejected = findExecutableSkillFiles(files);
  if (rejected.length > 0) {
    throw new Error(`executable_skill_file:${rejected.join(",")}`);
  }
  return { ...files };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((item) => typeof item === "string");
}

function readFileText(file: File): Promise<string> {
  if ("text" in file && typeof file.text === "function") return file.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read Skill package: ${file.name}`));
    reader.readAsText(file);
  });
}
