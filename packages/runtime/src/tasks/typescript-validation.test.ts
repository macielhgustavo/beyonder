import { describe, expect, it } from "vitest";
import { staticCodeReview, typescriptDiagnostics } from "./typescript-validation.js";

describe("standalone generated TypeScript static verification", () => {
  it.each([
    "function counts(values:string[]) { const dict:Record<string,number>={}; for(const value of values) dict[value]=(dict[value]||0)+1; return dict; }",
    "function buckets<T extends {key:string}>(values:T[]) { return values.reduce((acc,value)=>{if(!acc[value.key])acc[value.key]=[];acc[value.key].push(value);return acc;},{} as Record<string,T[]>); }",
    "function flags(values:string[]) { const original:Record<string,boolean>={}; const alias=original; for(const value of values) alias[value]=true; return original; }"
  ])("finds a dynamic ordinary-object dictionary without executing generated code: %s", source => {
    const review = staticCodeReview(source);
    expect(review.diagnostics).toEqual([]);
    expect(review.findings.length).toBeGreaterThan(0);
    expect(review.findings.every(f => f.includes("static source analysis"))).toBe(true);
  });
  it.each([
    "function counts(values:string[]) { const dict:Record<string,number>=Object.create(null); for(const value of values) dict[value]=(dict[value]||0)+1; return dict; }",
    "function counts(values:string[]) { const dict=new Map<string,number>(); for(const value of values) dict.set(value,(dict.get(value)||0)+1); return dict; }",
    "function fixed(key:'left'|'right') { const obj={left:1,right:2}; return obj[key]; }"
  ])("keeps safe dictionaries and constrained keys clear of the candidate finding: %s", source => {
    expect(staticCodeReview(source)).toEqual({ diagnostics: [], findings: [] });
  });
  it.each(["Node", "Request", "Response"])("allows a module-local %s declaration without an unrelated ambient DOM collision", name => {
    expect(typescriptDiagnostics(`class ${name}<T> { constructor(public value:T) {} } function wrap<T>(value:T):${name}<T> { return new ${name}(value); }`)).toEqual([]);
  });
  it.each([
    "function evict<K,V>(cache: Map<K,V>) { const oldest = cache.keys().next().value; cache.delete(oldest); }",
    "function count(xs: string[]): number { return xs.join(','); }",
    "function twice(value) { return value * 2; }"
  ])("rejects actual type errors, including an unchecked LRU iterator: %s", source => {
    expect(typescriptDiagnostics(`\`\`\`typescript\n${source}\n\`\`\``).length).toBeGreaterThan(0);
  });
  it.each([
    "function evict<K,V>(cache: Map<K,V>) { const oldest = cache.keys().next(); if (!oldest.done) cache.delete(oldest.value); }",
    "function unique<T extends {id:string}>(xs:T[]):T[] { const seen = new Set<string>(); return xs.filter(x => !seen.has(x.id) && Boolean(seen.add(x.id))); }",
    "function first<T>(xs:T[]):T|undefined { return xs[0]; }"
  ])("accepts compatible standalone code without running it: %s", source => {
    expect(typescriptDiagnostics(source)).toEqual([]);
  });
  it("does not execute top-level statements or permit reading arbitrary module files", () => {
    expect(typescriptDiagnostics("throw new Error('must never execute');")).toEqual([]);
    expect(typescriptDiagnostics("import secrets from '/etc/passwd';").join(" ")).toContain("TS2792");
  });
  it("checks exact bare declarations while allowing their prose explanation", () => {
    expect(typescriptDiagnostics("export function sum(xs: readonly number[]): number { return xs.reduce((a,b) => a+b,0); } A base vazia vale zero; cada passo adiciona o próximo elemento.")).toEqual([]);
    expect(typescriptDiagnostics("function count(xs:string[]):number { return xs.join(','); } This returns the count.").length).toBeGreaterThan(0);
  });
});
