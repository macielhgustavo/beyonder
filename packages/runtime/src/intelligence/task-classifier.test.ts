import { describe, expect, it } from "vitest";
import { TaskClassifier } from "./task-classifier.js";
import { ComplexityEstimator } from "./complexity-estimator.js";
import { analyzeGoalContract } from "./goal-contract.js";

describe("TaskClassifier", () => {
  const classifier = new TaskClassifier();

  it("classifies coding tasks deterministically", () => {
    expect(classifier.classify("Refactor this TypeScript interface and add tests")).toBe("coding");
  });
  it.each([
    "Escreva uma função TypeScript para agrupar itens pelo campo label string.",
    "Write a JavaScript function to classify messages by topic.",
    "Implemente uma função TypeScript para extrair campos de objetos."
  ])("preserves an explicit code artifact despite classification or extraction vocabulary: %s", input => {
    const type = classifier.classify(input);
    const contract = analyzeGoalContract(input, type);
    expect(type).toBe("coding");
    expect(contract).toMatchObject({ primaryIntent: "CODING", expectedResultKind: "CODE", qualityTarget: "HIGH" });
    expect(contract.requiredCapabilities).toContain("coding");
  });

  it.each(["Qual é a versão estável atual do Python?", "Qual é a versão atual do TypeScript?", "Compare as versões atuais de JavaScript e Python com fontes oficiais."])("does not require coding capacity for current software knowledge: %s", input => {
    const type = classifier.classify(input);
    expect(type).toBe("research");
    expect(new ComplexityEstimator().estimate(input, type).requirements).toMatchObject({ coding: false, browser: true, reasoning: true });
  });
  it.each(["O que é uma chave primária em SQL?", "Qual é a finalidade de uma API?", "O que significa uma classe em Python?"])("does not confuse a factual software topic with a code artifact: %s", input => {
    const type = classifier.classify(input);
    expect(type).toBe("chat");
    expect(new ComplexityEstimator().estimate(input, type).requirements.coding).toBe(false);
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
