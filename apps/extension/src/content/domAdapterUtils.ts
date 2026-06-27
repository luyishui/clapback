export function compactText(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

export function queryBySelectorPriority(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const node = root.querySelector<HTMLElement>(selector);
    if (node && compactText(node.textContent || "")) return node;
  }
  return null;
}

export function queryAllDeep(root: ParentNode, selector: string): HTMLElement[] {
  const results: HTMLElement[] = [];
  const visit = (scope: ParentNode) => {
    const rootShadow = (scope as { shadowRoot?: ShadowRoot | null }).shadowRoot ?? null;
    if (rootShadow) {
      visit(rootShadow);
    }
    results.push(...scope.querySelectorAll<HTMLElement>(selector));
    scope.querySelectorAll<HTMLElement>("*").forEach((node) => {
      if (node.shadowRoot) visit(node.shadowRoot);
    });
  };
  visit(root);
  return results;
}

export function fillEditor(editor: HTMLElement, value: string): void {
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    editor.value = value;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus();
    return;
  }

  editor.textContent = value;
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
  editor.focus();
}

export async function waitForReplyEditor(findEditor: () => HTMLElement | null, isAlive: () => boolean): Promise<HTMLElement | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isAlive()) return null;
    const editor = findEditor();
    if (editor) return editor;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

export function firstEditor(root: ParentNode, selector: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(selector)]
    .find((node) => !node.closest(".clapback-panel")) ?? null;
}
