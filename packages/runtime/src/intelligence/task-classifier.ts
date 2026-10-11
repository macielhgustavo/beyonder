import type { IntelligenceTaskType } from "./contracts.js";
import { browserIntent } from "./browser-intent.js";
import { calculatorIntent } from "./calculator-intent.js";
import { analyzeGoalContract } from "./goal-contract.js";

const RULES: Array<{ type: IntelligenceTaskType; patterns: RegExp[] }> = [
  {
    type: "coding",
    patterns: [
      /\b(?:refactor|debug|refatore|depure)\b/i,
      /\b(?:implement|implemente|implementar)\b/i,
      /\b(?:write|create|escreva|crie)\s+(?:(?:a|an|um|uma)\s+)?(?:(?!\b(?:summary|plan|report|explanation|resumo|plano|relatorio)\b)[\p{L}\d-]+\s+){0,6}(?:code|function|class|interface|test|código|função|classe|teste)s?\b/iu
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
    type: "synthesis",
    patterns: [/\b(?:synthesize|sintetize|sintetizar|integrate findings|combine findings)\b/i]
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
    if (browserIntent(input).navigation) return "browser";
    if (calculatorIntent(input).required) return "tool-use";
    // Classify the requested operation, not nouns in supplied content. Keep
    // instructions before a colon/fenced payload; within that instruction the
    // first action governs subordinate actions ("write a function to classify").
    const instruction = input.split(/```|:\s|\n/)[0];
    const operations = RULES.flatMap(rule => rule.patterns.flatMap(pattern => {
      const match = pattern.exec(instruction);
      return match ? [{ rule, position: match.index }] : [];
    })).sort((a, b) => a.position - b.position);
    const contract = analyzeGoalContract(input, "chat");
    if (contract.evidenceRequirement === "REQUIRED" &&
        (operations.length > 0 || contract.primaryIntent === "COMPARISON" || /^(?:qual|quais|quem|quando|onde|o que|what|which|who|when|where)\b/i.test(instruction)) &&
        !["CODING", "PLANNING"].includes(contract.primaryIntent)) return "research";
    for (const { rule } of operations) {
      if (rule.type === "coding") {
        // Language/software names are topic clues, not coding requirements.
        // The goal contract's actual intent remains authoritative.
        const codingContract = analyzeGoalContract(input, rule.type);
        if (codingContract.primaryIntent === "PLANNING") return "planning";
        if (["FACTUAL", "COMPARISON", "RESEARCH"].includes(codingContract.primaryIntent)) return codingContract.evidenceRequirement === "REQUIRED" || codingContract.primaryIntent === "RESEARCH" ? "research" : codingContract.primaryIntent === "COMPARISON" ? "reasoning" : "chat";
      }
      return rule.type;
    }
    return "chat";
  }
}
