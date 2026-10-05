import { describe, expect, it } from "vitest";
import { decorateModelDecisionCapacity, decorateTaskCapacity, NEEDS_CAPABILITY_MESSAGE } from "../data/capacity-aware";
import type { AuditEventView, ModelDecisionView, TaskView } from "../data/types";

function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: "task-1",
    taskId: "task-1",
    title: "Compare current providers",
    humanStatus: "Bloqueado por politica, verificacao ou entrada humana.",
    status: "blocked",
    result: null,
    resultVerified: false,
    objectiveStatus: "NEEDS_CAPABILITY",
    confidence: null,
    evidenceSources: [],
    provider: null,
    model: null,
    costUsd: 0,
    shadowCostUsd: 0,
    durationMs: 100,
    startedAt: "2026-10-05T00:00:00Z",
    completedAt: "2026-10-05T00:00:00Z",
    steps: [],
    why: ["Execucao ainda nao selecionou um modelo."],
    provenance: "local",
    ...overrides
  };
}

function audit(event: string, details: Record<string, unknown>): AuditEventView {
  return {
    id: `${event}-1`,
    level: event.includes("needs") ? "warn" : "info",
    event,
    humanEvent: event,
    details,
    createdAt: "2026-10-05T00:00:00Z",
    category: "all",
    provenance: "local"
  };
}

function decision(): ModelDecisionView {
  return {
    id: "decision-1",
    selectedLabel: "strong / cloud-a",
    utility: 0.81,
    reasons: [{ label: "historical performance", value: 0.9 }],
    penalties: [],
    alternatives: [],
    decidedAt: "2026-10-05T00:00:00Z",
    taskId: "task-1",
    humanWhy: ["Cloud escolhido por qualidade esperada."],
    provenance: "local"
  };
}

describe("capacity-aware Control Center", () => {
  it("shows NEEDS_CAPABILITY as an explicit blocked capacity state instead of generic failure", () => {
    const view = decorateTaskCapacity(task(), [
      audit("router.needs_capability", { taskId: "task-1", qualityFloor: { level: "HIGH", minimumOverall: 0.77 } })
    ]);
    expect(view.status).toBe("blocked");
    expect(view.humanStatus).toBe(NEEDS_CAPABILITY_MESSAGE);
    expect(view.failureSummary).toBe(NEEDS_CAPABILITY_MESSAGE);
    expect(view.humanStatus).toContain("compute local disponível está abaixo da qualidade mínima exigida");
  });

  it("marks qualified local airbag usage as capacity reduced without downgrading a verified success", () => {
    const view = decorateTaskCapacity(task({
      status: "succeeded",
      objectiveStatus: "SUCCEEDED",
      result: "resultado verificado",
      resultVerified: true,
      provider: "ollama",
      model: "qwen3.5:4b",
      humanStatus: "Concluído"
    }), [
      audit("router.capacity_reduced", { taskId: "task-1", selected: "ollama/qwen3.5:4b" })
    ]);
    expect(view.status).toBe("succeeded");
    expect(view.resultVerified).toBe(true);
    expect(view.humanStatus).toContain("Concluído com capacidade reduzida");
    expect(view.why.join(" ")).toContain("compute local de emergência");
  });

  it("adds tier, mission floor, capability fit and rejection count to the technical model decision", () => {
    const view = decorateModelDecisionCapacity(decision(), [
      audit("router.quality_floor_resolved", { taskId: "task-1", level: "HIGH", minimumOverall: 0.77 }),
      audit("router.selected", { taskId: "task-1", provider: "cloud-a", model: "strong", computeTier: "STRONG_FREE_CLOUD", capabilityFit: { overall: 0.91 } }),
      audit("router.candidate_rejected", { taskId: "task-1", provider: "ollama", model: "qwen3:4b", reasons: ["quality-floor:overall=0.49<0.77"] })
    ]);
    expect(view.reasons).toEqual(expect.arrayContaining([
      { label: "fallback tier", value: "STRONG_FREE_CLOUD" },
      { label: "capability fit", value: 0.91 },
      { label: "quality floor", value: "HIGH / 0.770" },
      { label: "candidatos rejeitados", value: 1 }
    ]));
    expect(view.humanWhy.join(" ")).toContain("audit técnico");
  });
});
