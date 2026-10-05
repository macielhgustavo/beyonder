import type { ToolDescriptor } from "@beyonder/tools";
import type { StepExecution } from "./contracts.js";

export function isReadOnlyBrowserTool(tool: ToolDescriptor): boolean {
  return tool.capabilities.includes("browser") && tool.sideEffects.every((effect) => effect === "READ" || effect === "NONE");
}

export function hasBrowserEvidence(steps: StepExecution[]): boolean {
  return browserEvidence(steps).sources.length > 0;
}

export function browserEvidence(steps: StepExecution[], objective = ""): { sources: string[]; excerpts: string[] } {
  const sources = new Set<string>();
  const excerpts: string[] = [];
  for (const step of steps) {
    if (step.status !== "COMPLETED" || !step.toolResult?.success || !step.toolCapabilities?.includes("browser")) continue;
    if (!Array.isArray(step.toolResult.sideEffects) || !step.toolResult.sideEffects.every((effect) => effect === "READ" || effect === "NONE")) continue;
    const output = step.toolResult.output as { result?: { status?: string; observation?: { url?: string; visibleText?: string }; data?: { text?: string } } } | undefined;
    const result = output?.result;
    const text = result?.observation?.visibleText?.trim() || result?.data?.text?.trim();
    if (result?.status !== "ok" || !text) continue;
    if (result.observation?.url) sources.add(result.observation.url);
    excerpts.push(relevantEvidenceExcerpt(text, objective, 1_400));
  }
  return { sources: [...sources], excerpts };
}

export function relevantEvidenceExcerpt(text: string, objective: string, limit: number): string {
  if (text.length <= limit) return text;
  const terms = [...new Set(normalize(objective).split(/[^a-z0-9]+/).filter((term) => term.length >= 4 && !STOP_WORDS.has(term)))];
  const separator = "\n[...content omitted...]\n";
  const segmentSize = Math.max(320, Math.floor((limit - separator.length * 2) / 3));
  const stride = Math.max(160, Math.floor(segmentSize / 2));
  const candidates: Array<{ start: number; end: number; score: number }> = [];
  for (let start = 0; start < text.length; start += stride) {
    const end = Math.min(text.length, start + segmentSize);
    const normalized = normalize(text.slice(start, end));
    const termScore = terms.reduce((score, term) => score + (normalized.includes(term) ? 2 : 0), 0);
    const structuredScore = /\b(?:rank|ranking|position|ratings?|share|trend|version|release|stable|current|index)\b/i.test(normalized) ? 4 : 0;
    const dataScore = /\b\d+(?:\.\d+)?\s*%|\bv?\d+\.\d+(?:\.\d+)?\b/i.test(normalized) ? 3 : 0;
    candidates.push({ start, end, score: termScore + structuredScore + dataScore });
    if (end === text.length) break;
  }
  const selected: typeof candidates = [];
  for (const candidate of candidates.sort((left, right) => right.score - left.score || left.start - right.start)) {
    if (selected.every((entry) => candidate.end <= entry.start || candidate.start >= entry.end)) selected.push(candidate);
    if (selected.length === 3) break;
  }
  if (!selected.length || selected[0]!.score === 0) {
    const half = Math.floor((limit - separator.length) / 2);
    return `${text.slice(0, half)}${separator}${text.slice(-half)}`;
  }
  return selected.sort((left, right) => left.start - right.start).map(({ start, end }) => text.slice(start, end).trim()).join(separator).slice(0, limit);
}

const STOP_WORDS = new Set(["about", "after", "antes", "como", "compare", "duas", "explain", "explique", "fontes", "mais", "quais", "sobre", "their", "what", "which"]);
function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
