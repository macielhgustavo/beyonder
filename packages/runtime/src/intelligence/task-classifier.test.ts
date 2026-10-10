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

  it.each(["Qual é a versão estável atual do Python?", "Qual é a versão atual do TypeScript?", "Compare as versões atuais de JavaScript e Python com fontes oficiais.", "Compare TIOBE e Stack Overflow atuais sobre linguagens: explique metodologia e por que os resultados podem discordar."])("does not require coding capacity for current software knowledge: %s", input => {
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


describe("operation and content are separate dimensions", () => {
  const classifier = new TaskClassifier();
  it.each([
    ["Implemente uma função TypeScript para ordenar valores.", "coding"],
    ["Sintetize em um parágrafo os prós e contras de cache local e cache distribuído para uma API pequena.", "synthesis"],
    ["Synthesize the supplied code review findings into a recommendation: refactor the Python function; add SQL tests.", "synthesis"],
    ["Summarize this code into two sentences: function classify() { return 'a'; }", "compression"],
    ["Planeje uma migração gradual de uma API com rollback.", "planning"],
    ["Prove that the sum of two even integers is even.", "reasoning"],
    ["Pesquise a versão atual de um software com fontes oficiais.", "research"],
    ["Extraia nome e prazo: Ana, terça; Bruno, sexta.", "extraction"],
    ["Classifique estes comentários de código por sentimento: ótimo; ruim.", "classification"],
    ["Compare local and distributed API caching tradeoffs.", "reasoning"]
  ])("classifies the governing operation: %s", (input, expected) => {
    const type = classifier.classify(input);
    expect(type).toBe(expected);
    const contract = analyzeGoalContract(input, type);
    expect(new ComplexityEstimator().estimate(input, type, contract).requirements.coding).toBe(expected === "coding");
  });
});
