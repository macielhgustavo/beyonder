import { describe, expect, it } from "vitest";
import { currentVersionLookup, observedCurrentVersion } from "./current-version.js";
import { researchSources, publicSearchUrl } from "./research-sources.js";

describe("generic current version evidence", () => {
  // This entity exists only in the test fixture, never in implementation catalogs.
  const entity = "Caddy";
  it("extracts an uncatalogued entity and routes it to source discovery", () => {
    const objective = `Qual é a versão atual do ${entity}?`;
    const lookup = currentVersionLookup(objective)!;
    expect(lookup).toEqual({ intent: "CURRENT_VERSION_LOOKUP", entity, channel: "stable" });
    expect(researchSources(objective)).toEqual([]);
    expect(new URL(publicSearchUrl(objective)).searchParams.get("q")).toContain(entity.toLowerCase());
    expect(observedCurrentVersion(lookup, `${entity} latest stable release 2.10.2. Download now.`)).toBe("2.10.2");
  });
  it("does not pick an unrelated, prerelease or ambiguous version", () => {
    const lookup = currentVersionLookup(`What is the current version of ${entity}?`)!;
    expect(observedCurrentVersion(lookup, "UnrelatedProject latest 99.1.0")).toBeUndefined();
    expect(observedCurrentVersion(lookup, `${entity} preview 2.11.0-beta1`)).toBeUndefined();
    expect(observedCurrentVersion(lookup, `${entity} download 2.10.1 and 2.10.2`)).toBeUndefined();
  });
});
