import type { EvidenceRequirement, ObjectiveFreshness, ObjectiveIntent, RequiredCapability } from "../intelligence/contracts.js";

export interface ProductAcceptanceObjective {
  category: string;
  objective: string;
  expected: {
    intent?: ObjectiveIntent;
    freshness?: ObjectiveFreshness;
    evidence?: EvidenceRequirement;
    capabilities?: RequiredCapability[];
    clarificationRequired?: boolean;
  };
}

/** Stable acceptance inputs. Assertions target behavior/invariants, never volatile answers. */
export const PRODUCT_ACCEPTANCE_CORPUS: ProductAcceptanceObjective[] = [
  { category: "static factual", objective: "What language runs natively in most web browsers?", expected: { intent: "FACTUAL", freshness: "STATIC", evidence: "PREFERRED" } },
  { category: "static factual", objective: "Explique o que é Node.js.", expected: { intent: "FACTUAL", freshness: "STATIC", evidence: "PREFERRED" } },
  { category: "static factual", objective: "What does HTTP status 404 mean?", expected: { intent: "FACTUAL", freshness: "STATIC", evidence: "PREFERRED" } },
  { category: "static factual", objective: "Qual é a finalidade de uma chave primária em SQL?", expected: { intent: "FACTUAL", freshness: "STATIC", evidence: "PREFERRED" } },

  { category: "current factual", objective: "qual a linguagem de programacao mais usada hoje", expected: { intent: "COMPARISON", freshness: "CURRENT", evidence: "REQUIRED", capabilities: ["web-research", "browser-read", "comparison"] } },
  { category: "current factual", objective: "Quem lidera o ranking de bancos de dados atualmente?", expected: { intent: "COMPARISON", freshness: "CURRENT", evidence: "REQUIRED", capabilities: ["browser-read"] } },
  { category: "current factual", objective: "Qual framework frontend é mais popular hoje?", expected: { intent: "COMPARISON", freshness: "CURRENT", evidence: "REQUIRED", capabilities: ["comparison"] } },
  { category: "current factual", objective: "What is the current stable Rust release?", expected: { intent: "FACTUAL", freshness: "CURRENT", evidence: "REQUIRED", capabilities: ["browser-read"] } },
  { category: "current factual", objective: "Qual é o preço atual do Bitcoin?", expected: { freshness: "CURRENT", evidence: "REQUIRED", capabilities: ["web-research"] } },
  { category: "current factual", objective: "Is the npm registry available now?", expected: { freshness: "REALTIME", evidence: "REQUIRED", capabilities: ["browser-read"] } },
  { category: "current factual", objective: "Quais são as notícias recentes do ecossistema TypeScript?", expected: { freshness: "RECENT", evidence: "PREFERRED" } },
  { category: "current factual", objective: "Who currently leads the TIOBE index?", expected: { intent: "COMPARISON", freshness: "CURRENT", evidence: "REQUIRED" } },

  { category: "latest software", objective: "qual a versao LTS atual do Node?", expected: { intent: "FACTUAL", freshness: "CURRENT", evidence: "REQUIRED", capabilities: ["browser-read"] } },
  { category: "latest software", objective: "Qual a versão estável atual do Python?", expected: { intent: "FACTUAL", freshness: "CURRENT", evidence: "REQUIRED" } },
  { category: "latest software", objective: "What is the latest stable PostgreSQL version?", expected: { intent: "FACTUAL", freshness: "CURRENT", evidence: "REQUIRED" } },
  { category: "latest software", objective: "Informe a versão atual do TypeScript.", expected: { intent: "FACTUAL", freshness: "CURRENT", evidence: "REQUIRED" } },

  { category: "comparative current", objective: "qual modelo open source esta mais forte hoje para coding?", expected: { intent: "COMPARISON", freshness: "CURRENT", evidence: "REQUIRED", capabilities: ["comparison", "reasoning"] } },
  { category: "comparative current", objective: "Compare duas fontes atuais sobre quais linguagens de programacao sao mais usadas e explique por que os rankings diferem.", expected: { intent: "COMPARISON", freshness: "CURRENT", evidence: "REQUIRED", capabilities: ["comparison", "citations"] } },
  { category: "comparative current", objective: "Which current JavaScript runtime has the strongest adoption?", expected: { intent: "COMPARISON", freshness: "CURRENT", evidence: "REQUIRED" } },
  { category: "comparative current", objective: "Hoje, qual banco vetorial tem maior adoção e por qual métrica?", expected: { intent: "COMPARISON", freshness: "CURRENT", evidence: "REQUIRED" } },

  { category: "arithmetic", objective: "27 * 14", expected: { intent: "CALCULATION", freshness: "STATIC", evidence: "NONE", capabilities: ["calculator"] } },
  { category: "arithmetic", objective: "Calcule 81 dividido por 9.", expected: { intent: "CALCULATION", freshness: "STATIC", evidence: "NONE", capabilities: ["calculator"] } },
  { category: "arithmetic", objective: "Calculate the square root of 144.", expected: { intent: "CALCULATION", freshness: "STATIC", evidence: "NONE", capabilities: ["calculator"] } },
  { category: "arithmetic", objective: "Quanto é 18 + 24?", expected: { intent: "CALCULATION", freshness: "STATIC", evidence: "NONE", capabilities: ["calculator"] } },

  { category: "coding", objective: "Write a TypeScript debounce function.", expected: { intent: "CODING", freshness: "STATIC", evidence: "NONE", capabilities: ["coding"] } },
  { category: "coding", objective: "Refatore src/server.js para reduzir duplicação.", expected: { intent: "CODING", freshness: "STATIC", evidence: "NONE" } },
  { category: "coding", objective: "Implemente uma função Python que agrupe itens por categoria.", expected: { intent: "CODING", freshness: "STATIC", evidence: "NONE" } },
  { category: "coding", objective: "Implement a TypeScript multiply(a, b) function.", expected: { intent: "CODING", freshness: "STATIC", evidence: "NONE" } },

  { category: "reasoning", objective: "Compare filas e logs append-only para este pipeline e explique os trade-offs.", expected: { intent: "COMPARISON", freshness: "STATIC", evidence: "PREFERRED", capabilities: ["reasoning"] } },
  { category: "reasoning", objective: "Why can eventual consistency be preferable to strong consistency?", expected: { intent: "REASONING", freshness: "STATIC", evidence: "NONE", capabilities: ["reasoning"] } },
  { category: "reasoning", objective: "Analise duas opções de cache para uma aplicação local-first.", expected: { intent: "REASONING", freshness: "STATIC", evidence: "NONE" } },

  { category: "planning", objective: "Faça um plano de implementação em 5 etapas para adicionar busca local.", expected: { intent: "PLANNING", freshness: "STATIC", evidence: "NONE", capabilities: ["planning"] } },
  { category: "planning", objective: "Make a migration plan from REST to event-driven processing.", expected: { intent: "PLANNING", freshness: "STATIC", evidence: "NONE" } },
  { category: "planning", objective: "Planeje uma investigação de latência sem alterar produção.", expected: { intent: "PLANNING", freshness: "STATIC", evidence: "NONE" } },

  { category: "explicit web research", objective: "Pesquise na web a documentação oficial do SQLite WAL.", expected: { intent: "RESEARCH", evidence: "REQUIRED", capabilities: ["web-research", "browser-read"] } },
  { category: "explicit web research", objective: "Research official sources about WebAuthn passkeys.", expected: { intent: "RESEARCH", evidence: "REQUIRED" } },
  { category: "explicit web research", objective: "Consulte o site oficial do Python e resuma a política de releases.", expected: { intent: "RESEARCH", evidence: "REQUIRED" } },
  { category: "explicit web research", objective: "Investigate two primary sources about SQLite durability.", expected: { intent: "RESEARCH", evidence: "REQUIRED", capabilities: ["citations"] } },

  { category: "implicit fresh research", objective: "Quem lidera a Premier League hoje?", expected: { freshness: "CURRENT", evidence: "REQUIRED", capabilities: ["browser-read"] } },
  { category: "implicit fresh research", objective: "Qual empresa tem maior valor de mercado atualmente?", expected: { freshness: "CURRENT", evidence: "REQUIRED" } },
  { category: "implicit fresh research", objective: "Which browser has the largest market share today?", expected: { freshness: "CURRENT", evidence: "REQUIRED" } },
  { category: "implicit fresh research", objective: "A API pública X está disponível agora?", expected: { freshness: "REALTIME", evidence: "REQUIRED" } },

  { category: "ambiguous answerable", objective: "Qual a melhor linguagem para começar em programação?", expected: { intent: "COMPARISON", clarificationRequired: false } },
  { category: "ambiguous answerable", objective: "What is the best database for a small local-first app?", expected: { intent: "COMPARISON", clarificationRequired: false } },
  { category: "genuinely ambiguous", objective: "Qual é o melhor?", expected: { clarificationRequired: true } },
  { category: "genuinely ambiguous", objective: "Compare isso.", expected: { clarificationRequired: true } },

  { category: "classification", objective: "Classifique este feedback como positivo, neutro ou negativo.", expected: { intent: "CLASSIFICATION", freshness: "STATIC", capabilities: ["structured-output"] } },
  { category: "classification", objective: "Categorize this issue as bug, feature, or support.", expected: { intent: "CLASSIFICATION" } },
  { category: "extraction", objective: "Extraia nome, email e empresa deste texto em JSON.", expected: { intent: "EXTRACTION", capabilities: ["structured-output"] } },
  { category: "extraction", objective: "Extract the release date and version from this paragraph.", expected: { intent: "EXTRACTION" } },

  { category: "memory", objective: "Lembre o que decidimos sobre o banco local.", expected: { intent: "MEMORY", capabilities: ["memory"] } },
  { category: "memory", objective: "Recall our previous decision about provider fallback.", expected: { intent: "MEMORY" } },
  { category: "short answer", objective: "Responda apenas OK.", expected: { freshness: "STATIC", evidence: "NONE" } },
  { category: "short answer", objective: "Reply only with READY.", expected: { freshness: "STATIC", evidence: "NONE" } },

  { category: "multi-step research", objective: "Pesquise duas fontes atuais sobre adoção de linguagens, compare as métricas e produza uma síntese curta.", expected: { intent: "COMPARISON", freshness: "CURRENT", evidence: "REQUIRED", capabilities: ["comparison", "citations"] } },
  { category: "multi-step research", objective: "Research the current Python and Node release cadences and compare them.", expected: { intent: "COMPARISON", freshness: "CURRENT", evidence: "REQUIRED" } },
  { category: "multi-step research", objective: "Investigue fontes oficiais recentes sobre passkeys e compare suporte entre navegadores.", expected: { intent: "COMPARISON", freshness: "RECENT", evidence: "REQUIRED" } },
  { category: "multi-step research", objective: "Compare current PostgreSQL and SQLite release policies using primary sources.", expected: { intent: "COMPARISON", freshness: "CURRENT", evidence: "REQUIRED" } },

  { category: "economic opportunity read-only", objective: "Pesquise oportunidades de programação disponíveis hoje sem enviar candidatura.", expected: { intent: "RESEARCH", freshness: "CURRENT", evidence: "REQUIRED" } },
  { category: "economic opportunity read-only", objective: "Find current public coding bounties in read-only mode.", expected: { intent: "RESEARCH", freshness: "CURRENT", evidence: "REQUIRED" } }
];

export const NON_ANSWER_REGRESSION_RESULTS = [
  "I don't know.",
  "I cannot access current information.",
  "As an AI, I cannot determine that.",
  "I am unable to determine that.",
  "Please search the web yourself.",
  "Desculpe, não tenho informações disponíveis sobre isso.",
  "Não consigo responder essa pergunta.",
  "Pesquise na web você mesmo."
] as const;
