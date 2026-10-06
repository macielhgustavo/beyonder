import { describe, expect, it } from "vitest";
import { browserEvidence, relevantEvidenceExcerpt } from "./browser-evidence.js";
import type { StepExecution } from "./contracts.js";

describe("relevance-aware browser evidence", () => {
  it.each(["Large transactions are slow", "Read-only mode is unavailable", "The older release is supported"])("does not promote a visibly superseded assertion into current evidence: %s", obsolete => {
    const excerpt = relevantEvidenceExcerpt(`Documentation [SUPERSEDED]${obsolete}[/SUPERSEDED] Current releases no longer have that restriction.`, "Explain the current behavior", 1400);
    expect(excerpt).not.toContain(obsolete); expect(excerpt).toContain("Current releases no longer have that restriction.");
  });
  it.each(["Search results", "Official documentation index", "Release discovery links"])("does not count %s as an observed substantive source", title => {
    const step = { id: "s", stepId: "s", attempt: 1, status: "COMPLETED", startedAt: "2026-10-05T00:00:00Z", completedAt: "2026-10-05T00:00:01Z", evidenceRole: "DISCOVERY", toolCapabilities: ["browser"], toolResult: { success: true, durationMs: 1000, sideEffects: ["READ"], output: { result: { status: "ok", observation: { url: "https://example.org/index", title, visibleText: "An unvisited source claims current 9.0" } } } } } as StepExecution;
    expect(browserEvidence([step])).toEqual({ sources: [], excerpts: [] });
    expect(browserEvidence([{ ...step, evidenceRole: "SOURCE" }]).excerpts[0]).toContain("Observed at 2026-10-05T00:00:01Z");
  });
  it("keeps material ranking data from the middle of a noisy page", () => {
    const noise = "cookie consent navigation marketing ".repeat(70);
    const ranking = "Sep 2026 Position Programming Language Ratings 1 Python 17.76% 2 C 10.28% 3 C++ 8.67% 4 Java 7.54% 5 C# 4.22%";
    const footer = "privacy contact unrelated archive ".repeat(70);

    const excerpt = relevantEvidenceExcerpt(`${noise}${ranking}${footer}`, "Compare fontes atuais e explique por que os rankings de linguagens diferem.", 1_000);

    expect(excerpt.length).toBeLessThanOrEqual(1_000);
    expect(excerpt).toContain("1 Python 17.76%");
    expect(excerpt).toContain("2 C 10.28%");
    expect(excerpt).toContain("4 Java 7.54%");
  });
});
