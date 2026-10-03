import type { ToolInputSchema, ToolInputValidation } from "./contracts.js";

export interface ToolValidationIssue {
  path?: readonly (string | number)[];
  code?: string;
  message: string;
}

export interface ToolValidationError {
  issues: readonly ToolValidationIssue[];
}

export function createToolInputSchema<TInput>(
  validate: (input: unknown) => ToolInputValidation<TInput>,
  jsonSchema?: unknown
): ToolInputSchema<TInput> {
  return {
    safeParse: validate,
    ...(jsonSchema === undefined ? {} : { jsonSchema })
  };
}

export function validationFailure(message: string, path?: readonly (string | number)[]): ToolInputValidation<never> {
  const error: ToolValidationError = {
    issues: [{ message, ...(path ? { path } : {}) }]
  };
  return { success: false, error };
}
