/** Syntax and observed evidence only: product names are never a source catalog. */
export interface CurrentVersionLookup { intent: "CURRENT_VERSION_LOOKUP"; entity: string; channel: "stable" | "lts" }

export function currentVersionLookup(objective: string): CurrentVersionLookup | undefined {
  if (!/\b(?:version|release|vers[aã]o|lts)\b/i.test(objective)) return undefined;
  const patterns = [
    /(?:vers[aã]o|version|release)(?:\s+(?:mais|recente|atual|est[aá]vel|latest|current|stable|lts))*\s+(?:de|do|da|of|for)\s+(.+?)(?=\s+(?:em|on|from|no|na|e|and|com|with|usando|using)\b|[?!,;\n]|$)/i,
    /(?:site\s+oficial|official\s+(?:site|website))\s+(?:de|do|da|of|for)\s+(.+?)(?=\s+(?:para|to|e|and)\b|[?!,;\n]|$)/i,
    /(?:current|latest|stable)\s+(.+?)\s+(?:version|release)\b/i
  ];
  const entity = patterns.map(pattern => objective.match(pattern)?.[1]?.trim()).find(Boolean);
  if (!entity || entity.length > 100 || /https?:|[<>{}]/.test(entity)) return undefined;
  return { intent: "CURRENT_VERSION_LOOKUP", entity, channel: /\blts\b/i.test(objective) ? "lts" : "stable" };
}

export function observedCurrentVersion(lookup: CurrentVersionLookup, evidence: string): string | undefined {
  const entity = fold(lookup.entity);
  const matches = [...evidence.matchAll(/\bv?\d{1,3}\.\d{1,3}(?:\.\d{1,3})?(?:-[a-z0-9.-]+)?\b/gi)];
  const supported = matches.filter(match => {
    const context = fold(evidence.slice(Math.max(0, match.index! - 90), match.index! + match[0].length + 90));
    return context.includes(entity) && /\b(?:latest|current|stable|estavel|atual|download|lts)\b/.test(context)
      && (lookup.channel !== "lts" || /\blts\b/.test(context))
      && !/\b(?:alpha|beta|rc\d*|preview|nightly|obsolete|archived)\b/.test(context);
  });
  const values = [...new Set(supported.map(match => match[0].replace(/^v/i, "")))];
  // Multiple supported releases need interpretation by research + verifier.
  return values.length === 1 ? values[0] : undefined;
}
function fold(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
