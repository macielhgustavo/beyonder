import { describe, it, expect } from "vitest";
import { hashContent, evidenceFromBrowserCapture } from "./evidence.js";

describe("Evidence primitives", () => {
  it("hashContent produces stable SHA-256", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
    expect(hashContent("hello")).not.toBe(hashContent("world"));
    expect(hashContent("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("evidenceFromBrowserCapture creates record with hash and provenance", () => {
    const evidence = evidenceFromBrowserCapture({
      missionId: "mission-1",
      nodeId: "node-1",
      url: "https://example.com/page",
      excerpt: "Important content",
      fullContent: "Full page content here",
      evidenceKind: "BROWSER_CAPTURE",
      trust: "UNTRUSTED",
      confidence: 0.7
    });

    expect(evidence.id).toContain("ev_");
    expect(evidence.missionId).toBe("mission-1");
    expect(evidence.nodeId).toBe("node-1");
    expect(evidence.evidenceKind).toBe("BROWSER_CAPTURE");
    expect(evidence.trust).toBe("UNTRUSTED");
    expect(evidence.confidence).toBe(0.7);
    expect(evidence.provenance.kind).toBe("BROWSER");
    expect((evidence.provenance as { kind: "BROWSER"; url: string }).url).toBe("https://example.com/page");
    expect(evidence.contentHash).toBe(hashContent("Important content"));
    expect(evidence.schemaVersion).toBe(1);
  });

  it("evidenceFromBrowserCapture uses defaults for optional fields", () => {
    const evidence = evidenceFromBrowserCapture({
      missionId: "mission-1",
      url: "https://example.com",
      excerpt: "content",
      fullContent: "full"
    });
    expect(evidence.trust).toBe("UNTRUSTED");
    expect(evidence.confidence).toBe(0.5);
  });
});