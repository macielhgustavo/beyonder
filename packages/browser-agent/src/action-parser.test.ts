import { describe, expect, it } from "vitest";
import { parseBrowserAction, parseBrowserActionJson } from "./action-parser.js";

describe("parseBrowserAction", () => {
  it("parses structured click actions", () => {
    expect(parseBrowserAction({ type: "click", target: { role: "button", name: "Documentation" } })).toEqual({
      type: "click",
      target: { role: "button", name: "Documentation" },
      authorizationId: undefined
    });
  });

  it("parses structured fill actions", () => {
    expect(parseBrowserActionJson('{"type":"fill","target":{"label":"Search"},"value":"Playwright browser context"}')).toEqual({
      type: "fill",
      target: { label: "Search" },
      value: "Playwright browser context"
    });
  });

  it("rejects arbitrary action types and malformed targets", () => {
    expect(() => parseBrowserAction({ type: "evaluate", javascript: "alert(1)" })).toThrow(/Unsupported browser action/);
    expect(() => parseBrowserAction({ type: "click", target: { role: "button", label: "Search" } })).toThrow(/exactly one/);
  });
});
