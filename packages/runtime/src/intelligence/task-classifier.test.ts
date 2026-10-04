import { describe, expect, it } from "vitest";
import { TaskClassifier } from "./task-classifier.js";
import { ComplexityEstimator } from "./complexity-estimator.js";

describe("TaskClassifier", () => {
  const classifier = new TaskClassifier();

  it("classifies coding tasks deterministically", () => {
    expect(classifier.classify("Refactor this TypeScript interface and add tests")).toBe("coding");
  });

  it.each([
    "Escreva uma função TypeScript pura chamada somar que receba dois números e retorne a soma.",
    "Implement a TypeScript multiply(a, b) function."
  ])("does not turn arithmetic vocabulary in coding objectives into a calculator requirement: %s", (input) => {
    const type = classifier.classify(input);
    expect(type).toBe("coding");
    expect(new ComplexityEstimator().estimate(input, type).requirements).toMatchObject({
      calculator: false,
      coding: true,
      toolUse: false,
      directResponse: true
    });
  });

  it.each([
    "Calcule 27 vezes 14.",
    "Use a calculadora para somar 2 + 2.",
    "Calculate the square root of 81."
  ])("retains concrete calculator intent: %s", (input) => {
    const type = classifier.classify(input);
    expect(type).toBe("tool-use");
    expect(new ComplexityEstimator().estimate(input, type).requirements.calculator).toBe(true);
  });

  it("classifies memory and compression tasks", () => {
    expect(classifier.classify("Remember what we decided previously about the runtime")).toBe("memory");
    expect(classifier.classify("Summarize this report into five lines")).toBe("compression");
  });

  it("falls back to chat when no stronger signal exists", () => {
    expect(classifier.classify("Hello, how are you today?")).toBe("chat");
  });
});
