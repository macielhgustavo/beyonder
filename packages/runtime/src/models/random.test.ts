import { describe, expect, it } from "vitest";
import { SeededRandomSource } from "./random.js";

describe("SeededRandomSource", () => {
  it("replays the same exploration sequence for the same seed", () => {
    const a = new SeededRandomSource(12345);
    const b = new SeededRandomSource(12345);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
});
