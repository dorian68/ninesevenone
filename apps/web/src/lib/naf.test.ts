import { describe, expect, it } from "vitest";
import { getNafLabel } from "@/lib/naf";

describe("NAF labels", () => {
  it("resolves an official rev. 2 sub-class label", () => {
    expect(getNafLabel("11.01Z")).toBe("Production de boissons alcooliques distillées");
  });

  it("returns null for an unknown or empty code", () => {
    expect(getNafLabel("99.99Z")).toBeNull();
    expect(getNafLabel(null)).toBeNull();
  });
});
