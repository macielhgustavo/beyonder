import { dirname, join, resolve } from "node:path";
import ts from "typescript";

interface StaticCodeReview { diagnostics: string[]; findings: string[]; }
let previousReview: { result: string; review: StaticCodeReview } | undefined;

/** Static verification only: generated code is never executed or emitted. */
export function typescriptDiagnostics(result: string): string[] {
  return staticCodeReview(result).diagnostics;
}

export function staticCodeReview(result: string): StaticCodeReview {
  if (previousReview?.result === result) return previousReview.review;
  const review = inspectCode(result);
  // Retain only bounded textual findings, never compiler graphs or runtime code.
  if (result.length <= 16_000) previousReview = { result, review };
  return review;
}

function inspectCode(result: string): StaticCodeReview {
  if (result.length > 16_000) return { diagnostics: ["Code result exceeds the bounded static-review limit."], findings: [] };
  const blocks = [...result.matchAll(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/gi)].map(match => match[1]!);
  const parsed = blocks.length ? undefined : ts.createSourceFile("answer.ts", result, ts.ScriptTarget.ES2022, true);
  const declarations = parsed?.statements.filter(statement => ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isVariableStatement(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement));
  // A bare declaration may be followed by a prose explanation. Keep its exact
  // source text, rather than trying to compile the narrative or repairing code.
  const source = blocks.length ? blocks.join("\n") : declarations?.length ? declarations.map(statement => result.slice(statement.getStart(parsed), statement.end)).join("\n") : result;
  if (source.length > 16_000) return { diagnostics: ["Code exceeds the bounded static-review limit."], findings: [] };
  const file = resolve("/beyonder-static-review/result.ts");
  const options: ts.CompilerOptions = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleDetection: ts.ModuleDetectionKind.Force, types: [] };
  const host = ts.createCompilerHost(options);
  const libDirectory = dirname(ts.getDefaultLibFilePath(options));
  const originalRead = host.readFile;
  const allowed = (path: string) => resolve(path).startsWith(`${libDirectory}/`) && /^lib\.[a-z0-9.]+\.d\.ts$/i.test(path.slice(libDirectory.length + 1));
  host.readFile = path => resolve(path) === file ? source : allowed(path) ? originalRead(path) : undefined;
  host.fileExists = path => resolve(path) === file || allowed(path) && ts.sys.fileExists(path);
  host.getSourceFile = (path, languageVersion) => {
    const text = host.readFile(path);
    return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true);
  };
  host.getDefaultLibFileName = () => join(libDirectory, "lib.es2022.full.d.ts");
  host.writeFile = () => { throw new Error("Static verification cannot emit files."); };
  const program = ts.createProgram([file], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).slice(0, 5).map(diagnostic => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  const sourceFile = program.getSourceFile(file);
  return { diagnostics, findings: sourceFile ? dictionaryFindings(sourceFile, program.getTypeChecker()) : [] };
}

function dictionaryFindings(source: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const findings = new Set<string>();
  const unwrap = (input: ts.Expression): ts.Expression => {
    let node = input;
    while (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
    return node;
  };
  const ordinaryObject = (input: ts.Expression, seen = new Set<ts.Symbol>()): boolean => {
    const node = unwrap(input);
    if (ts.isObjectLiteralExpression(node)) return node.properties.length === 0;
    if (!ts.isIdentifier(node)) return false;
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol || seen.has(symbol) || seen.size >= 8) return false;
    seen.add(symbol);
    const declaration = symbol.valueDeclaration;
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return ordinaryObject(declaration.initializer, seen);
    if (declaration && ts.isParameter(declaration)) {
      const callback = declaration.parent;
      if ((ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters[0] === declaration) {
        const parent = callback.parent;
        if (ts.isCallExpression(parent) && parent.arguments[0] === callback && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === "reduce" && parent.arguments[1]) return ordinaryObject(parent.arguments[1], seen);
      }
    }
    return false;
  };
  const visit = (node: ts.Node) => {
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ordinaryObject(node.expression)) {
      const key = checker.getTypeAtLocation(node.argumentExpression);
      const constituents = key.isUnion() ? key.types : [key];
      if (constituents.some(type => Boolean(type.flags & (ts.TypeFlags.String | ts.TypeFlags.Any | ts.TypeFlags.Unknown)))) {
        const location = source.getLineAndCharacterOfPosition(node.getStart(source));
        findings.add(`Line ${location.line + 1}: dynamic string-key access on an ordinary object initialized with {}. Valid strings such as constructor, toString and __proto__ may select inherited properties or a prototype setter instead of stored dictionary entries. Check the actual declared input domain and any guards. This is static source analysis, not an executed test.`);
      }
    }
    if (findings.size < 5) ts.forEachChild(node, visit);
  };
  visit(source);
  return [...findings];
}
