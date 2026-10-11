import type { CalculatorInput } from "@beyonder/tools";

/** A conservative grammar for a complete binary expression. No eval, inferred
 * operands, word-problem interpretation or partial matches are permitted. */
export function parseCalculatorExpression(input: string): CalculatorInput | undefined {
  const text = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/^(?:calcule|calcular|calculate|compute|quanto\s+e|what\s+is)\s+/, "")
    .replace(/[?.!]$/, "").trim()
    .replace(/\s+(?:(?:usando|utilizando|using|with|com)\s+(?:(?:a|o|the)\s+)?(?:calculadora|calculator))?(?:\s*(?:e\s*responda|and\s*(?:reply|respond)))?\s*(?:apenas|somente|only|just)\s+(?:(?:o|the)\s+)?(?:numero|number)$/, "")
    .replace(/\s+(?:usando|utilizando|using|with|com)\s+(?:(?:a|o|the)\s+)?(?:calculadora|calculator)$/, "");
  const number = "([+-]?\\d+(?:[.,]\\d+)?)";
  const match = text.match(new RegExp(`^${number}\\s*(multiplicado por|dividido por|multiplied by|divided by|vezes|times|mais|plus|menos|minus|[+*/×÷-])\\s*${number}$`));
  if (!match) return undefined;
  const operations: Record<string, CalculatorInput["operation"]> = {
    "+": "add", mais: "add", plus: "add", "-": "subtract", menos: "subtract", minus: "subtract",
    "*": "multiply", "×": "multiply", vezes: "multiply", times: "multiply", "multiplicado por": "multiply", "multiplied by": "multiply",
    "/": "divide", "÷": "divide", "dividido por": "divide", "divided by": "divide"
  };
  const operands = [Number(match[1]!.replace(",", ".")), Number(match[3]!.replace(",", "."))];
  if (!operands.every(Number.isFinite)) return undefined;
  return { operation: operations[match[2]!]!, operands };
}
