/** Calculator requirements come from an explicit tool request or a concrete
 * arithmetic expression, not from operation words used to describe code. */
export function calculatorIntent(input: string): { required: boolean; explicitTool: boolean } {
  const text = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const explicitTool =
    /\b(?:use|using|via|with|utilize|utilizando|use|usando|com)\b.{0,24}\b(?:calculator|calculadora)\b/.test(text) ||
    /\b(?:calculator|calculadora)\b.{0,24}\b(?:tool|ferramenta)\b/.test(text);
  if (explicitTool) return { required: true, explicitTool: true };

  const codingArtifact = /\b(?:code|implement|refactor|function|method|class|typescript|javascript|python|codigo|implemente|refatore|funcao|metodo|classe)\b/.test(text);
  if (codingArtifact) return { required: false, explicitTool: false };

  const arithmeticVerb = /\b(?:calculate|compute|calcule|calcular|multiplique|multiply|some|somar|add|subtract|subtraia|divide|divida)\b/.test(text);
  const numericOperands = (text.match(/-?\d+(?:[.,]\d+)?/g) ?? []).length >= 2;
  const unaryExpression = /\b(?:factorial|square root|sqrt|raiz quadrada|porcentagem|percent)\b/.test(text) && /\d/.test(text);
  return { required: arithmeticVerb && (numericOperands || unaryExpression), explicitTool: false };
}
