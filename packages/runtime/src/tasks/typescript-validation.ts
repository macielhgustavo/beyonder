import { dirname, join, resolve } from "node:path";
import ts from "typescript";

/** Static verification only: generated code is never executed or emitted. */
export function typescriptDiagnostics(result: string): string[] {
  if (result.length > 16_000) return ["Code result exceeds the bounded static-review limit."];
  const blocks = [...result.matchAll(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/gi)].map(match => match[1]!);
  const parsed = blocks.length ? undefined : ts.createSourceFile("answer.ts", result, ts.ScriptTarget.ES2022, true);
  const declarations = parsed?.statements.filter(statement => ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isVariableStatement(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement));
  // A bare declaration may be followed by a prose explanation. Keep its exact
  // source text, rather than trying to compile the narrative or repairing code.
  const source = blocks.length ? blocks.join("\n") : declarations?.length ? declarations.map(statement => result.slice(statement.getStart(parsed), statement.end)).join("\n") : result;
  if (source.length > 16_000) return ["Code exceeds the bounded static-review limit."];
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
  return ts.getPreEmitDiagnostics(program).slice(0, 5).map(diagnostic => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
}
