import { describe, expect, it } from "bun:test";
describe("OpenTUI API availability", () => {
  it("core imports exist", async () => {
    const core = await import("@opentui/core");
    expect(core.createCliRenderer).toBeDefined();
    expect(core.TextRenderable).toBeDefined();
    expect(core.BoxRenderable).toBeDefined();
    expect(core.ScrollBoxRenderable).toBeDefined();
    expect(core.InputRenderable).toBeDefined();
    expect(core.SelectRenderable).toBeDefined();
  });
});
