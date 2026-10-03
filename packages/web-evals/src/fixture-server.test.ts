import { describe, expect, it } from "vitest";
import { startFixtureServer } from "./fixture-server.js";

describe("fixture server", () => {
  it("serves deterministic local fixtures and rejects unknown paths", async () => {
    const server = await startFixtureServer();
    try {
      const page = await fetch(`${server.baseUrl}text.html`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Project codename: <strong>Atlas</strong>");

      const missing = await fetch(`${server.baseUrl}not-a-fixture.html`);
      expect(missing.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
