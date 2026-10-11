import { describe, expect, it } from "vitest";
import { alternativeSearchUrls, discoveredSourceScore, researchQuery, researchSources } from "./research-sources.js";

describe("read-only research source identities and recovery", () => {
  it.each(["CMake", "Deno", "Meson"])("does not promote repeated tutorial keywords over an observed release entry: %s", subject => {
    const objective = `Qual a versão estável atual de ${subject}? Cite a fonte oficial.`;
    const tutorial = { href: `https://tutorial.example/${subject}/${subject}/${subject}`, text: `${subject} ${subject} tutorial` };
    const release = { href: `https://${subject.toLowerCase()}.org/download/`, text: `Download ${subject}` };
    expect(discoveredSourceScore(release, objective)).toBeGreaterThan(discoveredSourceScore(tutorial, objective));
  });
  it.each([
    "Compare a popularidade atual de C e Python em duas fontes originais.",
    "Compare indicadores atuais para Rust e Java, com fontes originais.",
    "Pesquise rankings atuais de Ruby e C#, citando fontes observadas."
  ])("uses metric sources rather than the named language documentation: %s", objective => {
    expect(researchSources(objective).map(source => source.url)).toEqual(["https://www.tiobe.com/tiobe-index/", "https://pypl.github.io/PYPL.html"]);
  });
  it("honors explicitly requested original metrics when language names are present", () => {
    expect(researchSources("Compare popularidade atual de Python e Java segundo TIOBE e Stack Overflow.").map(source => source.url)).toEqual(["https://www.tiobe.com/tiobe-index/", "https://survey.stackoverflow.co/"]);
  });
  it.each(["Zig", "CMake", "Go"])("places the release subject before generic search intent: %s", subject => {
    expect(researchQuery(`Qual é a versão estável atual de ${subject}? Cite a fonte oficial e a data observada.`)).toBe(`${subject.toLowerCase()} latest stable release official`);
  });
  it("keeps LTS distinct and does not guess a version or source URL", () => {
    expect(researchQuery("Find the latest LTS version of Node.js from official sources")).toBe("node.js latest LTS release official");
    expect(researchSources("Qual a versão estável de CMake?")).toEqual([]);
  });
  it.each([
    "Abra https://docs.example.org/missing; se essa fonte falhar, use https://docs.example.org/current e explique os dados observados.",
    "Read https://source.example/a; if it fails, try https://other.example/b and cite what you read.",
    "Consulte https://official.example/old; se estiver indisponível, consulte https://official.example/new."
  ])("keeps an explicitly conditional URL as a fallback, not a second mandatory read: %s", objective => {
    const sources = researchSources(objective);
    expect(sources).toHaveLength(1); expect(sources[0]!.alternatives).toHaveLength(1);
  });
  it("retains both requested sources for an actual comparison", () => {
    expect(researchSources("Compare https://first.example/ e https://second.example/.")).toHaveLength(2);
  });
  it.each(["Go", "C", "R", "C++", "Node.js"])("does not drop a short or punctuated subject from discovery: %s", subject => {
    expect(researchQuery(`Qual é a versão atual de ${subject}? Cite a fonte oficial.`).split(" ")).toContain(subject.toLowerCase());
    expect(alternativeSearchUrls(`Find ${subject}`)).toHaveLength(1);
  });
});
