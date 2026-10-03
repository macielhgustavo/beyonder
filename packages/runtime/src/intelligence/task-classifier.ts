import type { IntelligenceTaskType } from "./contracts.js";

const RULES: Array<{ type: IntelligenceTaskType; patterns: RegExp[] }> = [
  {
    type: "coding",
    patterns: [
      /\b(code|coding|implement|refactor|debug|bug|typescript|javascript|python|sql|api|function|class|interface|repo|repository|commit|test|tests)\b/i,
      /\b(código|implemente|implementar|refatore|depure|erro|função|classe|interface|repositório|teste|testes)\b/i,
      /```/,
      /\.[cm]?[jt]sx?\b/i
    ]
  },
  {
    type: "browser",
    patterns: [
      /https?:\/\//i,
      /\b(browser|browse|navigate|open (the )?(site|page)|website|web page)\b/i,
      /\b(navegue|abra (o )?(site|link|página)|site|página web)\b/i
    ]
  },
  {
    type: "research",
    patterns: [
      /\b(research|sources?|evidence|literature|compare sources|investigate)\b/i,
      /\b(pesquise|pesquisa|fontes|evidências|literatura|investigue)\b/i
    ]
  },
  {
    type: "extraction",
    patterns: [
      /\b(extract|parse|scrape|collect fields?|pull out|structured data)\b/i,
      /\b(extraia|extrair|parsear|coletar campos|dados estruturados)\b/i
    ]
  },
  {
    type: "classification",
    patterns: [
      /\b(classify|classification|categorize|label|tag)\b/i,
      /\b(classifique|classificação|categorize|rotule|etiquete)\b/i
    ]
  },
  {
    type: "planning",
    patterns: [
      /\b(plan|roadmap|strategy|milestone|architecture plan|steps? to)\b/i,
      /\b(plano|planeje|roadmap|estratégia|marco|etapas? para)\b/i
    ]
  },
  {
    type: "memory",
    patterns: [
      /\b(remember|recall|memory|what did we|previously)\b/i,
      /\b(lembre|lembrar|memória|recorde|anteriormente)\b/i
    ]
  },
  {
    type: "compression",
    patterns: [
      /\b(summarize|compress|shorten|condense|tl;?dr)\b/i,
      /\b(resuma|resumir|comprima|encurte|condense)\b/i
    ]
  },
  {
    type: "tool-use",
    patterns: [
      /\b(run|execute|invoke|use (a )?tool|command line|shell command)\b/i,
      /\b(rode|execute|invoque|use (uma )?ferramenta|comando)\b/i
    ]
  },
  {
    type: "reasoning",
    patterns: [
      /\b(reason|reasoning|analyze|prove|derive|solve|why|trade-?offs?)\b/i,
      /\b(raciocine|raciocínio|analise|prove|derive|resolva|por que|trade-?offs?)\b/i
    ]
  }
];

export class TaskClassifier {
  classify(input: string): IntelligenceTaskType {
    for (const rule of RULES) {
      if (rule.patterns.some((pattern) => pattern.test(input))) return rule.type;
    }
    return "chat";
  }
}
