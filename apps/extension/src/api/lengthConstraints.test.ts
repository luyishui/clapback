import { describe, expect, it } from "vitest";
import {
  countEffectiveChars,
  isWithinLengthConstraint,
  resolveLengthConstraint,
  trimToMaxChars,
} from "./lengthConstraints";

describe("length constraints", () => {
  it("counts only effective text units and ignores punctuation, spaces, and emoji", () => {
    expect(countEffectiveChars("你这话，先别急。AB 12 😂")).toBe(10);
  });

  it("uses target length as a soft acceptance budget for custom short replies", () => {
    const constraint = resolveLengthConstraint({ lengthMode: "自定义", customLengthTarget: 10 });

    expect(constraint).toMatchObject({ targetChars: 10, minChars: 5, maxChars: 20 });
    expect(constraint.label).toContain("目标 10 个汉字");
    expect(constraint.label).not.toContain("20");
    expect(isWithinLengthConstraint("别急，先把证据拿出来。", constraint)).toBe(true);
  });

  it("accepts complete medium and long custom replies within dynamic soft bounds", () => {
    const target50 = resolveLengthConstraint({ lengthMode: "自定义", customLengthTarget: 50 });
    const seventyEffectiveChars = "论".repeat(70);

    expect(target50).toMatchObject({ minChars: 30, maxChars: 80 });
    expect(countEffectiveChars(seventyEffectiveChars)).toBe(70);
    expect(isWithinLengthConstraint(seventyEffectiveChars, target50)).toBe(true);

    const target100 = resolveLengthConstraint({ lengthMode: "自定义", customLengthTarget: 100 });
    expect(target100).toMatchObject({ minChars: 75, maxChars: 150 });
  });

  it("trims by effective text units without counting punctuation against the budget", () => {
    expect(trimToMaxChars("你，真，的，很，会，偷，换，概，念。", 6)).toBe("你，真，的，很，会，偷");
  });
});
