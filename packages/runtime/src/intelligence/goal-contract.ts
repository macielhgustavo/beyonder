import type {
  GoalContract,
  IntelligenceTaskType,
  ObjectiveFreshness,
  ObjectiveIntent,
  ObjectiveResultKind,
  RequiredCapability
} from "./contracts.js";
import { browserIntent } from "./browser-intent.js";

const SIGNALS = {
  realtime: ["agora", "neste momento", "em tempo real", "right now", "now", "real time", "live"],
  current: ["hoje", "atualmente", "atual", "atuais", "mais recente", "ultima versao", "versao atual", "mais usada", "mais usado", "mais popular", "lidera", "lider", "preco", "disponibilidade", "ranking", "today", "currently", "current", "latest", "most used", "most popular", "leader", "price", "availability", "ranking"],
  recent: ["recente", "recentes", "ultimos dias", "ultima semana", "recent", "recently", "last few days", "last week"],
  research: ["pesquise", "pesquisar", "procure", "encontre", "investigue", "consulte", "fontes", "evidencias", "research", "search", "find", "investigate", "look up", "sources", "evidence"],
  web: ["site", "pagina", "web", "internet", "online", "website", "browser", "http://", "https://"],
  comparison: ["compare", "comparar", "diferem", "diferenca", "diferencas", "contraste", "versus", " vs ", "melhor", "mais usada", "mais usado", "mais popular", "mais forte", "maior adocao", "maior valor", "maior market share", "lidera", "ranking", "compare", "difference", "best", "most used", "most popular", "strongest", "largest market share", "strongest adoption", "leads"],
  citations: ["cite", "citacao", "citacoes", "fonte", "fontes", "source", "sources", "citation", "citations"],
  planning: ["plano", "planeje", "etapas", "roadmap", "plan", "steps", "strategy"],
  reasoning: ["explique por que", "analise", "raciocine", "trade-off", "compare", "why", "analyze", "reason", "tradeoff"],
  coding: ["implemente", "refatore", "debug", "escreva codigo", "funcao", "typescript", "javascript", "python", "write code", "implement", "refactor", "function"],
  calculation: ["calcule", "quanto e", "multiplique", "divida", "calculate", "multiply", "divide"],
  extraction: ["extraia", "colete", "extrair", "extract", "collect", "parse"],
  classification: ["classifique", "categorize", "rotule", "classify", "categorize", "label"],
  memory: ["lembre", "recorde", "memoria", "remember", "recall", "memory"]
} as const;

export function analyzeGoalContract(input: string, type: IntelligenceTaskType): GoalContract {
  const normalizedObjective = input.trim().replace(/\s+/g, " ");
  const searchable = fold(normalizedObjective);
  const freshness = detectFreshness(searchable);
  const comparison = hasAny(searchable, SIGNALS.comparison);
  const explicitResearch = hasAny(searchable, SIGNALS.research);
  const explicitWeb = browserIntent(normalizedObjective).required;
  const currentEvidence = freshness === "CURRENT" || freshness === "REALTIME";
  // Broad verbs such as "find" also describe local/tool work. They become an
  // external research requirement only with research routing or another
  // explicit external-evidence signal.
  const researchIntent = explicitResearch && (type === "research" || explicitWeb || currentEvidence || hasAny(searchable, SIGNALS.citations));
  const primaryIntent = detectIntent(searchable, type, comparison, researchIntent);
  const requiresResearchExecution = researchIntent && (primaryIntent !== "PLANNING" || hasAny(searchable, SIGNALS.citations));
  const evidenceRequirement = currentEvidence || requiresResearchExecution || explicitWeb ? "REQUIRED" : primaryIntent === "FACTUAL" || primaryIntent === "COMPARISON" ? "PREFERRED" : "NONE";
  const requiredCapabilities = capabilitiesFor({ searchable, type, primaryIntent, comparison, evidenceRequirement });
  const jsonOutput = /\b(?:somente|apenas|only|just)\s+(?:valid\s+)?json\b|\b(?:retorne|return|responda|respond|forneca|provide)\s+(?:(?:somente|apenas|only|just|em|in|valid)\s+)*json\b/.test(searchable);
  if (jsonOutput && !requiredCapabilities.includes("structured-output")) requiredCapabilities.push("structured-output");
  const domain = detectDomain(searchable);
  const ambiguityLevel = detectAmbiguity(searchable, primaryIntent, domain);
  const clarificationRequired = ambiguityLevel === "HIGH" && !canExplainAmbiguity(primaryIntent, domain, searchable);
  const expectedResultKind = resultKind(primaryIntent, comparison, searchable);
  const minimumEvidenceSources = evidenceRequirement === "REQUIRED" ? comparison ? 2 : 1 : 0;

  return {
    version: 1,
    normalizedObjective,
    ...(jsonOutput ? { outputFormat: "JSON" as const } : {}),
    primaryIntent,
    domain,
    freshness,
    evidenceRequirement,
    requiredCapabilities,
    ambiguityLevel,
    clarificationRequired,
    successCriteria: [
      { id: "answer-objective", description: "The result directly answers the operator's objective.", required: true, kind: "CONTENT" },
      ...(evidenceRequirement === "REQUIRED" ? [{ id: "current-evidence", description: `Use at least ${minimumEvidenceSources} observed external source${minimumEvidenceSources === 1 ? "" : "s"}.`, required: true, kind: "EVIDENCE" as const }] : []),
      ...(comparison ? [{ id: "explain-comparison", description: "Explain material differences and the relevant criteria or assumptions. For measured rankings, scope any winner to the observed metric; search interest, downloads and survey samples do not prove universal usage.", required: true, kind: "CONTENT" as const }] : []),
      ...(primaryIntent === "CALCULATION" ? [{ id: "calculator-evidence", description: "Use deterministic calculator evidence.", required: true, kind: "CAPABILITY" as const }] : []),
      { id: "technical-correctness", description: primaryIntent === "CODING" ? "Code must satisfy the full declared input domain, output types, ordering, mutation and complexity constraints; compilation alone does not prove behavior." : "Every material technical or conceptual claim must be correct; a common implementation example must not be stated as a necessary or universal property.", required: true, kind: "CONTENT" },
      { id: "requested-format", description: "Respect the requested result format and language.", required: true, kind: "FORMAT" }
    ],
    expectedResultKind,
    qualityTarget: currentEvidence || comparison || (type === "research" && primaryIntent === "PLANNING") || ["REASONING", "RESEARCH", "CODING"].includes(primaryIntent) ? "HIGH" : expectedResultKind === "SHORT_ANSWER" || expectedResultKind === "CALCULATION" ? "MINIMAL" : "STANDARD",
    minimumEvidenceSources,
    analysisMethod: "hybrid"
  };
}

function detectFreshness(input: string): ObjectiveFreshness {
  if (hasAny(input, SIGNALS.realtime)) return "REALTIME";
  if (/\b(?:noticias|news)\b/.test(input) && !hasAny(input, SIGNALS.recent)) return "CURRENT";
  if (hasAny(input, SIGNALS.current)) return "CURRENT";
  if (hasAny(input, SIGNALS.recent)) return "RECENT";
  return "STATIC";
}

function detectIntent(input: string, type: IntelligenceTaskType, comparison: boolean, research: boolean): ObjectiveIntent {
  // Explicit code generation owns its artifact contract even when field names
  // or implementation verbs also mention classification or extraction.
  if (hasAny(input, SIGNALS.coding) && /\b(?:implemente|refatore|escreva|write|implement|refactor|crie|create)\b/.test(input)) return "CODING";
  if (type === "classification" || hasAny(input, SIGNALS.classification)) return "CLASSIFICATION";
  if (type === "extraction" || hasAny(input, SIGNALS.extraction)) return "EXTRACTION";
  if (hasAny(input, SIGNALS.calculation) || /\b\d+(?:[.,]\d+)?\s*(?:\*|x|×|\/|\+|-)\s*\d+(?:[.,]\d+)?\b/.test(input)) return "CALCULATION";
  if (comparison) return "COMPARISON";
  if (type === "planning" || hasAny(input, SIGNALS.planning)) return "PLANNING";
  if (research) return "RESEARCH";
  if (type === "browser") return "FACTUAL";
  if (type === "reasoning" || hasAny(input, SIGNALS.reasoning)) return "REASONING";
  if (type === "memory" || hasAny(input, SIGNALS.memory)) return "MEMORY";
  if (/^(?:qual|quais|quem|quando|onde|o que|explique o que|informe|what|which|who|when|where|how|explain what)\b/.test(input) || input.includes("?")) return "FACTUAL";
  // The execution may require research to answer a factual current question.
  // Routing metadata must not change what the user actually asked for.
  if (type === "research") return "RESEARCH";
  return "OTHER";
}

function capabilitiesFor(input: { searchable: string; type: IntelligenceTaskType; primaryIntent: ObjectiveIntent; comparison: boolean; evidenceRequirement: GoalContract["evidenceRequirement"] }): RequiredCapability[] {
  const capabilities = new Set<RequiredCapability>();
  if (input.evidenceRequirement === "REQUIRED") { capabilities.add("web-research"); capabilities.add("browser-read"); }
  if (input.comparison) capabilities.add("comparison");
  if (hasAny(input.searchable, SIGNALS.citations) || input.evidenceRequirement === "REQUIRED") capabilities.add("citations");
  if (input.primaryIntent === "CALCULATION") capabilities.add("calculator");
  // Classifier type is useful routing metadata, but incidental product names
  // must not become a capability requirement. The contract follows intent.
  if (input.primaryIntent === "CODING") capabilities.add("coding");
  if (["REASONING", "RESEARCH", "COMPARISON"].includes(input.primaryIntent)) capabilities.add("reasoning");
  if (input.primaryIntent === "PLANNING") capabilities.add("planning");
  if (input.type === "classification" || input.type === "extraction") capabilities.add("structured-output");
  if (input.primaryIntent === "MEMORY") capabilities.add("memory");
  return [...capabilities];
}

function detectDomain(input: string): string {
  if (/\b(?:programacao|linguagem|software|node(?:\.js)?|python|typescript|javascript|coding|code|developer|modelo open source)\b/.test(input)) return "software-development";
  if (/\b(?:mercado|acao|acoes|bolsa|cripto|preco|finance|stock|market|crypto)\b/.test(input)) return "markets";
  if (/\b(?:noticia|eleicao|governo|presidente|news|election|government|president)\b/.test(input)) return "current-affairs";
  if (/\b(?:arquitetura|architecture|database|banco de dados|api)\b/.test(input)) return "software-architecture";
  return "general";
}

function detectAmbiguity(input: string, intent: ObjectiveIntent, domain: string): GoalContract["ambiguityLevel"] {
  const words = input.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && /\b(?:melhor|best|isso|that|it)\b/.test(input) && domain === "general") return "HIGH";
  if (intent === "COMPARISON" && /\b(?:melhor|best|mais usada|most used|mais forte|strongest)\b/.test(input)) return "MEDIUM";
  return "LOW";
}

function canExplainAmbiguity(intent: ObjectiveIntent, domain: string, input: string): boolean {
  return intent === "COMPARISON" && (domain !== "general" || input.split(/\s+/).length > 4);
}

function resultKind(intent: ObjectiveIntent, comparison: boolean, input: string): ObjectiveResultKind {
  if (intent === "CALCULATION") return "CALCULATION";
  if (intent === "CODING") return "CODE";
  if (intent === "PLANNING") return "PLAN";
  if (intent === "CLASSIFICATION" || intent === "EXTRACTION") return "STRUCTURED_DATA";
  if (comparison) return "COMPARISON";
  if (/\b(?:apenas|somente|only|just|responda so|answer only)\b/.test(input)) return "SHORT_ANSWER";
  return "EXPLANATION";
}

function hasAny(input: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => input.includes(phrase));
}

function fold(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
