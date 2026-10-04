import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelDecisionInspector } from "../components/model-decision-inspector";

const decision = {
  id: "decision-test",
  selectedLabel: "Qwen / Groq",
  utility: 0.87,
  reasons: [{ label: "coding capability", value: 0.91 }],
  penalties: [{ label: "latency", value: 0.03 }],
  alternatives: [{ label: "Llama / Kilo", utility: 0.82 }],
  decidedAt: "2026-10-03T01:00:00Z",
  humanWhy: ["Selected for coding capability."],
  provenance: "mock" as const
};

describe("ModelDecisionInspector", () => {
  it("renders structured decision evidence", () => {
    const html = renderToStaticMarkup(<ModelDecisionInspector decision={decision} />);
    expect(html).toContain("Qwen / Groq");
    expect(html).toContain("coding capability");
    expect(html).toContain("Llama / Kilo");
  });

  it("renders a truthful empty state without a decision", () => {
    const html = renderToStaticMarkup(<ModelDecisionInspector decision={null} />);
    expect(html).toContain("Nenhuma escolha de modelo registrada");
  });
});
