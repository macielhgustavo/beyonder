import { describe, expect, it } from "vitest";
import { TaskClassifier } from "./task-classifier.js";

describe("TaskClassifier", () => {
  const classifier = new TaskClassifier();

  it("classifies coding tasks deterministically", () => {
    expect(classifier.classify("Refactor this TypeScript interface and add tests")).toBe("coding");
  });

  it("classifies memory and compression tasks", () => {
    expect(classifier.classify("Remember what we decided previously about the runtime")).toBe("memory");
    expect(classifier.classify("Summarize this report into five lines")).toBe("compression");
  });

  it("falls back to chat when no stronger signal exists", () => {
    expect(classifier.classify("Hello, how are you today?")).toBe("chat");
  });
});
