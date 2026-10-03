import type { BenchmarkCase, BenchmarkCategory, BenchmarkMode } from "../types.js";

export const BENCHMARK_CATEGORIES: BenchmarkCategory[] = [
  "reasoning",
  "coding",
  "planning",
  "tool-use",
  "structured-output",
  "extraction",
  "compression",
  "instruction-following"
];

export const BENCHMARK_CASES: BenchmarkCase[] = [
  exact("reasoning-001", "reasoning", "Answer with only the number: A train leaves at 09:10 and arrives at 11:05. How many minutes did the trip take?", 1, "115", true),
  exact("reasoning-002", "reasoning", "Answer with only the letter: If all dax are mip, and no mip are vorn, can any dax be vorn? A) yes B) no", 1, "B", true),
  exact("reasoning-003", "reasoning", "Answer with only the number: There are 4 boxes with 6 pencils each. You give away 9 pencils. How many remain?", 1, "15"),
  exact("reasoning-004", "reasoning", "Answer with only the number: What is the next value in 3, 6, 12, 24, ?", 1, "48"),
  exact("reasoning-005", "reasoning", "Answer with only true or false: If Ana is older than Bo and Bo is older than Cy, Ana is older than Cy.", 1, "true"),

  code("coding-001", "Write JavaScript only. Define function sumEven(numbers) that returns the sum of even numbers.", "sumEven", [[[[1, 2, 3, 4]], 6], [[[5, 7, 8]], 8]], true),
  code("coding-002", "Write JavaScript only. Define function reverseWords(text) that reverses word order while preserving words.", "reverseWords", [[["one two three"], "three two one"], [["solo"], "solo"]], true),
  code("coding-003", "Write JavaScript only. Define function uniqueSorted(numbers) that returns unique numbers sorted ascending.", "uniqueSorted", [[[[3, 1, 3, 2]], [1, 2, 3]]]),
  code("coding-004", "Write JavaScript only. Define function clamp(n, min, max) that constrains n to the inclusive range.", "clamp", [[[5, 1, 4], 4], [[-2, 0, 9], 0]]),
  code("coding-005", "Write JavaScript only. Define function countVowels(text) that counts a,e,i,o,u case-insensitively.", "countVowels", [[["Idea"], 3], [["rhythm"], 0]]),

  contains("planning-001", "Produce a 4-item numbered checklist to move a static site to a new host. Include backup and rollback.", "planning", ["1.", "2.", "3.", "4.", "backup", "rollback"], true),
  contains("planning-002", "Plan a two-hour bug triage session. Include owners, severity sorting, reproduction, and follow-up.", "planning", ["owners", "severity", "reproduction", "follow-up"], true),
  contains("planning-003", "Create a launch checklist for a CLI feature. Include tests, docs, release notes, and rollback.", "planning", ["tests", "docs", "release notes", "rollback"]),
  contains("planning-004", "Plan database migration rehearsal. Include snapshot, dry run, timing, verification, and abort criteria.", "planning", ["snapshot", "dry run", "timing", "verification", "abort"]),
  contains("planning-005", "Create a plan for provider onboarding review. Include terms, billing risk, quota, validation, and credential storage.", "planning", ["terms", "billing", "quota", "validation", "credential"]),

  schema("structured-output-001", "Return only JSON for a book with title, author, and pages. Use title 'Dune', author 'Frank Herbert', pages 412.", ["title", "author", "pages"], true),
  schema("structured-output-002", "Return only JSON with keys ok:boolean and retryAfterSeconds:number. Use ok false and retryAfterSeconds 30.", ["ok", "retryAfterSeconds"], true),
  schema("structured-output-003", "Return only JSON with keys name, tags, active. tags must be an array.", ["name", "tags", "active"]),
  schema("structured-output-004", "Return only JSON with keys provider, model, category, score. Use score as a number.", ["provider", "model", "category", "score"]),
  schema("structured-output-005", "Return only JSON with keys city, country, populationEstimate.", ["city", "country", "populationEstimate"]),

  contains("extraction-001", "Extract name and total from: Invoice for Mara Lopes. Total: $48.90. Return concise JSON.", "extraction", ["Mara Lopes", "48.90"], true),
  contains("extraction-002", "Extract date and status from: Deploy completed on 2026-10-01 with status GREEN. Return concise JSON.", "extraction", ["2026-10-01", "GREEN"], true),
  contains("extraction-003", "Extract provider and model from: Provider=Groq; Model=llama-3.3-70b-versatile; Cost=$0.", "extraction", ["Groq", "llama-3.3-70b-versatile"]),
  contains("extraction-004", "Extract email and ticket id from: Contact ana@example.com about TCK-1842.", "extraction", ["ana@example.com", "TCK-1842"]),
  contains("extraction-005", "Extract action and deadline from: Please rotate the key before Friday 17:00 UTC.", "extraction", ["rotate", "Friday", "17:00 UTC"]),

  heuristic("compression-001", "Compress to one sentence preserving facts: Beyonder uses zero-cost-first routing, skips billing-risk providers, and stores benchmark results by model and category.", "compression", ["zero-cost", "billing-risk", "model", "category"], true),
  heuristic("compression-002", "Summarize in under 25 words preserving facts: The smoke benchmark is small, cheap, repeatable, and runs before trusting a newly discovered model.", "compression", ["smoke", "cheap", "repeatable", "model"], true),
  heuristic("compression-003", "Compress preserving all names: Alice assigned API validation, Bruno assigned ranking, and Carla assigned reporting.", "compression", ["Alice", "Bruno", "Carla"]),
  heuristic("compression-004", "Summarize preserving numbers: Standard mode uses about 5 to 10 cases per category and should remain economical.", "compression", ["5", "10", "category", "economical"]),
  heuristic("compression-005", "Compress preserving constraints: no paid providers, no dashboard, no browser, no adaptive router.", "compression", ["paid", "dashboard", "browser", "adaptive router"]),

  schema("tool-use-001", "Choose a tool for this task: find local files matching a pattern. Return only JSON with tool and reason.", ["tool", "reason"], true, "tool-use"),
  contains("tool-use-002", "Choose one tool name only for current weather in Paris: shell, weather, database, email.", "tool-use", ["weather"], true),
  contains("tool-use-003", "Choose one tool name only for SQL aggregation over a table: browser, database, image, calendar.", "tool-use", ["database"]),
  contains("tool-use-004", "Choose one tool name only to list files in a repo: shell, email, calendar, image.", "tool-use", ["shell"]),
  contains("tool-use-005", "Choose one tool name only to send a meeting invite: calendar, shell, image, database.", "tool-use", ["calendar"]),

  contains("instruction-following-001", "Reply with exactly three comma-separated lowercase colors, no bullets.", "instruction-following", [","], true),
  contains("instruction-following-002", "Reply with the word READY and nothing else.", "instruction-following", ["READY"], true),
  contains("instruction-following-003", "Reply in two lines. First line: alpha. Second line: beta.", "instruction-following", ["alpha", "beta"]),
  contains("instruction-following-004", "Return exactly five words and include the word benchmark.", "instruction-following", ["benchmark"]),
  contains("instruction-following-005", "Reply with a JSON array of exactly three strings.", "instruction-following", ["[", "]"])
];

export function getBenchmarkCases(mode: BenchmarkMode): BenchmarkCase[] {
  return mode === "smoke" ? BENCHMARK_CASES.filter((testCase) => testCase.smoke) : BENCHMARK_CASES;
}

function exact(id: string, category: BenchmarkCategory, prompt: string, difficulty: number, expected: string, smoke = false): BenchmarkCase {
  return { id, category, prompt, difficulty, evaluator: "exact", expected, smoke };
}

function contains(id: string, prompt: string, category: BenchmarkCategory, terms: string[], smoke = false): BenchmarkCase {
  return { id, category, prompt, difficulty: 1, evaluator: "contains", expected: terms, smoke };
}

function schema(id: string, prompt: string, required: string[], smoke = false, category: BenchmarkCategory = "structured-output"): BenchmarkCase {
  return { id, category, prompt, difficulty: 1, evaluator: "json-schema", expected: { required }, smoke };
}

function code(id: string, prompt: string, functionName: string, tests: Array<[unknown[], unknown]>, smoke = false): BenchmarkCase {
  return { id, category: "coding", prompt, difficulty: 2, evaluator: "code-test", expected: { functionName, tests }, smoke };
}

function heuristic(id: string, prompt: string, category: BenchmarkCategory, mustContain: string[], smoke = false): BenchmarkCase {
  return { id, category, prompt, difficulty: 1, evaluator: "heuristic", expected: { mustContain }, smoke };
}
