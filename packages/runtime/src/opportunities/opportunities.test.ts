import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/client.js";
import { StateStore } from "../memory/state-store.js";
import { AgentWorkPublicOpportunitySource, DeterministicFixtureOpportunitySource, GitHubPublicOpportunitySource, OpenBountyPublicOpportunitySource } from "./sources.js";
import { OpportunityEngine } from "./engine.js";
import { normalizeOpportunity } from "./normalizer.js";
import { StateOpportunityStore } from "./store.js";

describe("opportunity engine", () => {
  it("discovers, normalizes, persists and deduplicates fixture opportunities", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    const store = new StateOpportunityStore(new StateStore(db));
    const engine = new OpportunityEngine([new DeterministicFixtureOpportunitySource()], store);
    const first = await engine.discover({ source: "fixture", limit: 3 });
    const second = await engine.discover({ source: "fixture", limit: 3 });

    expect(first.opportunities).toHaveLength(3);
    expect(second.opportunities).toHaveLength(3);
    expect(await engine.list()).toHaveLength(3);
    expect(first.opportunities.find((item) => item.sourceItemId === "task-c")?.requirements.requiresPayment).toBe(true);
    expect(first.opportunities.find((item) => item.sourceItemId === "task-a")?.status).toBe("NORMALIZED");
    sqlite.close();
  });

  it("preserves unknown reward and creates a stable fingerprint", () => {
    const normalized = normalizeOpportunity({ source: "fixture", title: "Unpriced work", description: "No amount is stated." }, "2026-10-03T00:00:00.000Z");
    expect(normalized.reward).toBeUndefined();
    expect(normalized.id).toMatch(/^opportunity:/);
    expect(normalized.fingerprint).toHaveLength(24);
  });

  it("keeps explicit GitHub reward evidence and ignores ordinary issues", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([
      { id: 1, html_url: "https://github.com/a/b/issues/1", title: "Help wanted", body: "Bounty: $25 for a tested fix.", labels: [{ name: "help wanted" }] },
      { id: 2, html_url: "https://github.com/a/b/issues/2", title: "Question", body: "How does this work?", labels: [] }
    ]), { status: 200 }));
    const source = new GitHubPublicOpportunitySource({ repository: "a/b", fetchImpl: fetchImpl as typeof fetch });
    const result = await source.discover();
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.reward?.amount).toBe(25);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns read-only source errors without throwing", async () => {
    const source = new GitHubPublicOpportunitySource({ fetchImpl: async () => new Response("no", { status: 503 }) });
    const result = await source.discover();
    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("HTTP 503");
  });

  it("normalizes AgentWork jobs and preserves malformed/unknown fields safely", async () => {
    const source = new AgentWorkPublicOpportunitySource({ fetchImpl: async () => new Response(JSON.stringify({ gigs: [
      { id: "gig-1", title: "Research a public API", description: "Return a short report", skillsRequired: ["research"], budgetUsd: "5", deadline: "2026-12-01" },
      null, { id: "bad" }
    ] }), { status: 200 }) });
    const result = await source.discover();
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.reward?.amount).toBe(5);
    expect(result.items[0]?.metadata).toMatchObject({ requiresApplication: true, requiresAuthentication: true, requiresSubmission: true });
  });

  it("discovers explicit Open Bounty rewards without enabling mutation", async () => {
    const source = new OpenBountyPublicOpportunitySource({ fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 42, title: "Research a public API", description: "Return a report", category: "Research", rewardUsdc: "5", expiresAt: "2026-12-01T00:00:00.000Z" }] }), { status: 200 }) });
    const result = await source.discover();
    expect(result.errors).toEqual([]); expect(result.items[0]?.reward).toMatchObject({ amount: 5, currency: "USDC" }); expect(result.items[0]?.metadata).toMatchObject({ requiresWallet: true, requiresOnchainAction: true });
  });

  it("preserves an HTTP failure as a source error", async () => {
    const result = await new OpenBountyPublicOpportunitySource({ fetchImpl: async () => new Response("down", { status: 503 }) }).discover();
    expect(result.items).toEqual([]); expect(result.errors[0]).toContain("HTTP 503");
  });
});
