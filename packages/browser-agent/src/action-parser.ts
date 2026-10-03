import type { BrowserAction, BrowserTarget } from "./types.js";

export function parseBrowserAction(input: unknown): BrowserAction {
  if (!isRecord(input) || typeof input.type !== "string") {
    throw new TypeError("Browser action must be an object with a string type.");
  }

  switch (input.type) {
    case "open":
    case "navigate":
      return { type: input.type, url: requiredString(input.url, "url") };
    case "observe":
    case "back":
    case "current":
    case "close":
      return { type: input.type };
    case "extractText":
      return {
        type: "extractText",
        target: input.target === undefined ? undefined : parseTarget(input.target),
        maxChars: optionalPositiveInteger(input.maxChars, "maxChars")
      };
    case "find":
      return { type: "find", target: parseTarget(input.target) };
    case "click":
      return {
        type: "click",
        target: parseTarget(input.target),
        authorizationId: optionalString(input.authorizationId, "authorizationId")
      };
    case "fill":
      return {
        type: "fill",
        target: parseTarget(input.target),
        value: requiredString(input.value, "value", true)
      };
    case "scroll": {
      const direction = input.direction;
      if (direction !== "up" && direction !== "down") {
        throw new TypeError('scroll.direction must be "up" or "down".');
      }
      return {
        type: "scroll",
        direction,
        amount: optionalPositiveInteger(input.amount, "amount")
      };
    }
    case "screenshot":
      return {
        type: "screenshot",
        fullPage: optionalBoolean(input.fullPage, "fullPage")
      };
    case "waitFor": {
      const state = input.state;
      if (state !== undefined && state !== "attached" && state !== "visible" && state !== "hidden") {
        throw new TypeError('waitFor.state must be "attached", "visible", or "hidden".');
      }
      return {
        type: "waitFor",
        target: parseTarget(input.target),
        state,
        timeoutMs: optionalPositiveInteger(input.timeoutMs, "timeoutMs")
      };
    }
    default:
      throw new TypeError(`Unsupported browser action type: ${input.type}`);
  }
}

export function parseBrowserActionJson(input: string): BrowserAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new TypeError("Browser action input must be valid JSON.");
  }
  return parseBrowserAction(parsed);
}

export function parseTarget(input: unknown): BrowserTarget {
  if (!isRecord(input)) {
    throw new TypeError("Browser target must be an object.");
  }

  const exact = optionalBoolean(input.exact, "target.exact");
  const keys = ["role", "label", "text", "placeholder", "testId"].filter((key) => typeof input[key] === "string");
  if (keys.length !== 1) {
    throw new TypeError("Browser target must define exactly one of role, label, text, placeholder, or testId.");
  }

  const key = keys[0]!;
  switch (key) {
    case "role": {
      const target: { role: string; name?: string; exact?: boolean } = { role: requiredString(input.role, "target.role") };
      if (input.name !== undefined) target.name = requiredString(input.name, "target.name");
      if (exact !== undefined) target.exact = exact;
      return target;
    }
    case "label": {
      const target: { label: string; exact?: boolean } = { label: requiredString(input.label, "target.label") };
      if (exact !== undefined) target.exact = exact;
      return target;
    }
    case "text": {
      const target: { text: string; exact?: boolean } = { text: requiredString(input.text, "target.text") };
      if (exact !== undefined) target.exact = exact;
      return target;
    }
    case "placeholder": {
      const target: { placeholder: string; exact?: boolean } = { placeholder: requiredString(input.placeholder, "target.placeholder") };
      if (exact !== undefined) target.exact = exact;
      return target;
    }
    case "testId":
      return { testId: requiredString(input.testId, "target.testId") };
    default:
      throw new TypeError("Unsupported browser target.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(`${name} must be a${allowEmpty ? "" : " non-empty"} string.`);
  }
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean.`);
  return value;
}

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}
