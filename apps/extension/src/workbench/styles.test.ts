import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = fs.readFileSync(path.resolve("src/workbench/styles.css"), "utf8");
const componentStyles = fs.readFileSync(path.resolve("src/workbench/components/components.css"), "utf8");

describe("Workbench layout styles", () => {
  it("keeps the desktop sidebar fixed while the main pane scrolls", () => {
    expect(styles).toMatch(/\.workbench-shell\s*{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.workbench-main\s*{[^}]*overflow-y:\s*auto;/s);
  });

  it("restores natural page scrolling on mobile", () => {
    expect(styles).toMatch(/@media\s*\(max-width:\s*767px\)\s*{[^}]*\.workbench-shell\s*{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s);
  });

  it("skins shared form controls with paper surfaces and custom affordances", () => {
    expect(componentStyles).toMatch(/\.select-field\s*{[^}]*appearance:\s*none;/s);
    expect(componentStyles).toMatch(/\.select-field\s*{[^}]*background-image:\s*linear-gradient/s);
    expect(componentStyles).toMatch(/\.input-field\[type="number"\]\s*{[^}]*appearance:\s*textfield;/s);
    expect(componentStyles).toMatch(/\.input-field\[type="number"\]::-webkit-inner-spin-button/s);
    expect(componentStyles).toMatch(/\.workbench-checkbox\s*{[^}]*appearance:\s*none;/s);
  });
});
