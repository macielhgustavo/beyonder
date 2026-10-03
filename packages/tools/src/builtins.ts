import {
  ToolRisk,
  ToolSideEffect,
  type ToolDefinition,
  type ToolInputValidation
} from "./contracts.js";
import { createToolInputSchema, validationFailure } from "./schema.js";

export type CalculatorOperation = "add" | "subtract" | "multiply" | "divide";

export interface CalculatorInput {
  operation: CalculatorOperation;
  operands: number[];
}

export interface CalculatorOutput {
  value: number;
}

const calculatorJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["operation", "operands"],
  properties: {
    operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] },
    operands: { type: "array", minItems: 1, items: { type: "number" } }
  }
} as const;

export const calculatorTool: ToolDefinition<CalculatorInput, CalculatorOutput> = {
  id: "calculator",
  name: "Calculator",
  description: "Perform deterministic arithmetic over a list of finite numbers.",
  inputSchema: createToolInputSchema(validateCalculatorInput, calculatorJsonSchema),
  risk: ToolRisk.NONE,
  sideEffects: ToolSideEffect.NONE,
  capabilities: ["calculation", "deterministic"],
  execute(input) {
    const [first, ...rest] = input.operands;
    const value = input.operation === "add"
      ? input.operands.reduce((sum, operand) => sum + operand, 0)
      : input.operation === "multiply"
        ? input.operands.reduce((product, operand) => product * operand, 1)
        : input.operation === "subtract"
          ? rest.reduce((current, operand) => current - operand, first!)
          : rest.reduce((current, operand) => current / operand, first!);
    return { output: { value } };
  }
};

export interface JsonParseInput {
  text: string;
}

export const jsonParseTool: ToolDefinition<JsonParseInput, unknown> = {
  id: "json.parse",
  name: "JSON Parse",
  description: "Parse a JSON string without external side effects.",
  inputSchema: createToolInputSchema(validateJsonParseInput, {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } }
  }),
  risk: ToolRisk.NONE,
  sideEffects: ToolSideEffect.NONE,
  capabilities: ["json", "parsing", "deterministic"],
  execute(input) {
    return { output: JSON.parse(input.text) as unknown };
  }
};

export const SAFE_BUILTIN_TOOLS = [calculatorTool, jsonParseTool] as const;

function validateCalculatorInput(input: unknown): ToolInputValidation<CalculatorInput> {
  if (!isRecord(input)) return validationFailure("Expected an object.");
  if (!isExactKeys(input, ["operation", "operands"])) return validationFailure("Unexpected calculator argument.");
  if (!isCalculatorOperation(input.operation)) return validationFailure("Unsupported calculator operation.", ["operation"]);
  if (!Array.isArray(input.operands) || input.operands.length === 0 || input.operands.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    return validationFailure("operands must be a non-empty array of finite numbers.", ["operands"]);
  }
  if (["subtract", "divide"].includes(input.operation) && input.operands.length < 2) {
    return validationFailure(`${input.operation} requires at least two operands.`, ["operands"]);
  }
  if (input.operation === "divide" && input.operands.slice(1).some((value) => value === 0)) {
    return validationFailure("Division by zero is not allowed.", ["operands"]);
  }
  return { success: true, data: { operation: input.operation, operands: [...input.operands] } };
}

function validateJsonParseInput(input: unknown): ToolInputValidation<JsonParseInput> {
  if (!isRecord(input)) return validationFailure("Expected an object.");
  if (!isExactKeys(input, ["text"])) return validationFailure("Unexpected JSON parse argument.");
  if (typeof input.text !== "string") return validationFailure("text must be a string.", ["text"]);
  return { success: true, data: { text: input.text } };
}

function isCalculatorOperation(value: unknown): value is CalculatorOperation {
  return value === "add" || value === "subtract" || value === "multiply" || value === "divide";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExactKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}
