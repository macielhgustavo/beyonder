/** Source identities and stable entry points; no release/ranking answers live here. */
export interface ResearchSource { url: string; alternatives: string[]; topic?: string; discoveryTopics?: string[]; }

const OFFICIAL: ReadonlyArray<{ names: RegExp; release: string; docs: string; alternatives: string[]; topics?: Record<string, string>; policy?: string }> = [
  { names: /\bpython\b/, release: "https://www.python.org/downloads/", docs: "https://docs.python.org/3/", policy: "https://devguide.python.org/versions/", alternatives: ["https://www.python.org/downloads/source/"] },
  { names: /\bnode(?:\.js)?\b/, release: "https://nodejs.org/", docs: "https://nodejs.org/en/about/previous-releases", alternatives: ["https://nodejs.org/en/about/previous-releases", "https://github.com/nodejs/node/releases"] },
  { names: /\btypescript\b/, release: "https://www.typescriptlang.org/", docs: "https://www.typescriptlang.org/docs/", alternatives: ["https://github.com/microsoft/TypeScript/releases"] },
  { names: /\brust\b/, release: "https://blog.rust-lang.org/", docs: "https://doc.rust-lang.org/", alternatives: ["https://doc.rust-lang.org/stable/"] },
  { names: /\bgo\b/, release: "https://go.dev/dl/", docs: "https://go.dev/doc/", alternatives: ["https://go.dev/doc/devel/release"] },
  { names: /\bpostgres(?:ql)?\b/, release: "https://www.postgresql.org/", docs: "https://www.postgresql.org/docs/current/", policy: "https://www.postgresql.org/support/versioning/", topics: { transaction: "https://www.postgresql.org/docs/current/tutorial-transactions.html" }, alternatives: ["https://www.postgresql.org/support/versioning/"] },
  { names: /\bsqlite\b/, release: "https://sqlite.org/", docs: "https://sqlite.org/docs.html", topics: { wal: "https://sqlite.org/wal.html", transaction: "https://sqlite.org/lang_transaction.html" }, alternatives: ["https://www.sqlite.org/docs.html"] }
];

export function researchSources(objective: string): ResearchSource[] {
  const text = normalize(objective);
  const explicit: ResearchSource[] = [];
  let previousEnd = 0;
  for (const match of objective.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    try {
      const url = new URL(match[0].replace(/[),.;!?]+$/, ""));
      if (url.username || url.password) continue;
      const relation = normalize(objective.slice(previousEnd, match.index));
      const conditionalFallback = /\b(?:se|if)\b.{0,100}(?:falh|fail|indisponivel|unavailable).{0,100}\b(?:use|tente|try|utilize|consulte|open)\b/.test(relation);
      if (conditionalFallback && explicit.length) explicit.at(-1)!.alternatives.push(url.href);
      else explicit.push({ url: url.href, alternatives: [] });
      previousEnd = match.index! + match[0].length;
    } catch { /* Invalid candidates never become source identities. */ }
  }
  if (explicit.length) return explicit;
  const ranking = /(?:popularidade|popularity|ranking|mais\s+usad|most\s+used|indicador)/.test(text)
    && /\blinguage|\blanguages?\b|\b(?:python|javascript|java|typescript|rust|go|ruby|swift|kotlin|php|scala|perl|julia)\b|\bc(?:[+#]{1,2})?(?!\w)/.test(text);
  const indices: ResearchSource[] = [];
  if (/\btiobe\b/.test(text)) indices.push({ url: "https://www.tiobe.com/tiobe-index/", alternatives: [] });
  if (/\bpypl\b/.test(text)) indices.push({ url: "https://pypl.github.io/PYPL.html", alternatives: [] });
  if (/\bstack\s*overflow\b/.test(text)) indices.push({ url: "https://survey.stackoverflow.co/", alternatives: [], discoveryTopics: ranking ? ["results", "technology"] : ["results"] });
  // A language mentioned in a popularity comparison is the subject, not a
  // request for its release/documentation page. Prefer original metric sources.
  if (ranking) return indices.length ? indices : [{ url: "https://www.tiobe.com/tiobe-index/", alternatives: [] }, { url: "https://pypl.github.io/PYPL.html", alternatives: [] }];
  const policy = /\b(?:politica|policy|suporte|support|ciclo|cycle)\b/.test(text);
  const release = !policy && /\b(?:versao|version|release|lts|stable|estavel)\b/.test(text);
  const topic = /\bwal\b/.test(text) ? "wal" : /\btransa(?:cao|coes)|\btransactions?\b/.test(text) ? "transaction" : undefined;
  const sources: ResearchSource[] = OFFICIAL.filter(source => source.names.test(text)).map(source => ({ url: release ? source.release : policy && source.policy ? source.policy : topic && source.topics?.[topic] ? source.topics[topic] : source.docs, alternatives: source.alternatives, ...(topic && !source.topics?.[topic] ? { topic } : {}) }));
  sources.push(...indices);
  return sources;
}

export function researchQuery(objective: string): string {
  const terms = (normalize(objective).replace(/https?:\/\/[^\s]+/g, " ").match(/[a-z0-9]+(?:[.#][a-z0-9]+)*[+#]*/g) ?? []).filter(term => term !== "from" && !QUERY_STOP_WORDS.has(term));
  // Public discovery returned unrelated results for Portuguese release intent
  // ahead of a short product name. Keep the subject first and express this
  // generic intent consistently; discovered links still require protected reads.
  if (/\b(?:versao|versions?|releases?|stable|estavel|lts)\b/.test(normalize(objective))) {
    const subjects = [...new Set(terms.filter(term => !RELEASE_QUERY_WORDS.has(term)))].slice(0, 5);
    if (subjects.length) return `${subjects.join(" ")} latest ${/\blts\b/.test(normalize(objective)) ? "LTS" : "stable"} release official`;
  }
  return [...new Set(terms)].slice(0, 10).join(" ");
}

export function publicSearchUrl(objective: string): string {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", researchQuery(objective));
  return url.href;
}

export function alternativeSearchUrls(objective: string): string[] {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", researchQuery(objective));
  return [url.href];
}

/** Rank observed candidates, never count their links/snippets as evidence. */
export function discoveredSourceScore(candidate: { href: string; text: string }, objective: string): number {
  const queryTerms = new Set(researchQuery(objective).split(" "));
  const terms = new Set(normalize(`${candidate.text} ${candidate.href}`).split(/[^a-z0-9]+/));
  const overlap = [...terms].filter(term => queryTerms.has(term)).length;
  const release = /\b(?:versao|version|release|stable|estavel|lts)\b/.test(normalize(objective));
  // Repetition in a long tutorial path is not greater relevance. A named
  // project's domain and observed release/download links are stronger clues,
  // but remain candidates requiring a protected read and independent review.
  const namedDomain = new URL(candidate.href).hostname.split(".").some(label => queryTerms.has(label) && !RELEASE_QUERY_WORDS.has(label));
  const releaseEntry = release && /\b(?:download|downloads|releases?)\b/.test(normalize(`${candidate.text} ${new URL(candidate.href).pathname}`));
  return overlap + (namedDomain ? 2 : 0) + (releaseEntry ? 1 : 0);
}

export function normalize(value: string): string { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
const RELEASE_QUERY_WORDS = new Set(["versao", "version", "versions", "release", "releases", "stable", "estavel", "lts", "oficial", "official", "latest", "ultima", "ultimo", "recente", "software", "atualmente", "download", "downloads"]);
const QUERY_STOP_WORDS = new Set(["a", "o", "e", "de", "da", "do", "as", "os", "um", "em", "no", "na", "is", "it", "to", "of", "an", "be", "or", "on", "in", "at", "by", "for", "encontre", "find", "observado", "qual", "quais", "what", "which", "compare", "consulte", "pesquise", "explique", "explain", "cite", "fonte", "fontes", "source", "sources", "sobre", "about", "como", "cada", "apenas", "somente", "por", "para", "the", "and", "with", "hoje", "atuais", "atual", "current", "observada", "data", "date", "mais", "duas", "two", "uma", "one", "nos", "dos", "das", "que", "faz", "use", "using"]);
