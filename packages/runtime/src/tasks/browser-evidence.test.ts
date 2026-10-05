import { describe, expect, it } from "vitest";
import { relevantEvidenceExcerpt } from "./browser-evidence.js";

describe("relevance-aware browser evidence", () => {
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
