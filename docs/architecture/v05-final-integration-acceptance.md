# v0.5 final integration: technical qualification and blocked product acceptance

This branch is an integrated technical candidate. It is **not a qualified v0.5 human acceptance candidate**. No merge into `main`, `feat/control-center`, or PR #18 was performed. Gustavo's personal approval remains required after the outstanding product gates pass.

## Exact provenance and conflicts

- INTEGRATION_BASE: `09ad25e3d3c38c17adc9f1c38d3d9c4309e374ec` (`feat/control-center`).
- CLOUD_ROUTING_SOURCE_HEAD: `aa6e4027e637b2b1f2a92b5813f9a5fc4cb1d70d`.
- PREMIUM_UI_SOURCE_HEAD: `d99b2259945d8e6a8515fa6d7ccfaa47a2d32f34`.
- Branch: `feat/v05-final-integration`, created exactly at the base after fetch, exact-head verification, a clean-tree check, ancestry comparison and changed-file overlap review. The three remote heads were checked again before publication.
- Cloud merge: `223b394e4c5edfd87605eb450ae2a41e7bde5c1c`; premium merge: `c105aa2329ea82c1262a392ef1bf6f59542494c0`. Both retain the original source commit as a parent. No squash.
- Textual conflicts: none; modified-file overlap between source branches: none. Semantic conflicts involved the premium Resources presentation versus capacity/floor telemetry, transient mission state versus asynchronous verification, and capacity warnings versus runtime pause/health controls. Those behaviors were integrated together, without choosing ours/theirs or redesigning the interface.
- FINAL_INTEGRATION_HEAD: the commit containing this report is delivered with its exact hash in the final qualification manifest and response. A report cannot embed its own commit hash.

## Findings, systemic fixes and regressions

The acceptance pass reproduced real functional issues, beyond selector fragility:

1. Static factual responses could become SUCCEEDED merely because they were nonempty. A deliberately unrelated answer and invalid requested JSON both reproduced false success in the initial controlled baseline (2/7 bad cases). All nondeterministic results now require independent semantic verification; explicit JSON formatting is represented in GoalContract and validated before success. Original failures and two unseen factual/JSON analogs were repeated.
2. The first verifier could see stale producer attempts. Attempts are synchronized before evaluating, so the actual last producer is excluded from independent verification. Controlled successful missions assert distinct producer/verifier identities.
3. An intermediate failure or route-rejection audit could prematurely terminate UI polling before verification persisted. Capacity decoration now follows authoritative objective status; transient verification remains live and polling waits for the persisted terminal objective/phase/completion boundary. Running and recovered-result regressions cover stale audit events.
4. Home refresh lost the active polling context. The command surface now initializes from the actual persisted active mission. A delayed real supervisor/UI journey reloads during execution and must receive the verified terminal state without further navigation.
5. Capacity warnings overwrote PAUSED and concealed Resume. Runtime pause/offline/degraded heartbeat truth now takes precedence; UI pause/resume and two additional health states have regressions.
6. Explicit local configuration bypassed adaptive cloud priority and quality gates. It now uses the same selector, rejects inadequate local capacity and retains cloud-first policy. Dead legacy direct-local routing was removed.
7. An unobserved operational latency of zero masked real historical latency. Observed performance is now used when health has no samples. MINIMAL missions prioritize useful efficiency within a tier after every quality dimension passes; HIGH quality selection retains its quality weighting. The original trivial factual objective plus two unseen analogous objectives select the efficient adequate cloud. Weak candidates remain rejected for difficult coding.
8. Ordinary complete binary arithmetic needlessly required model capacity. A conservative generic expression grammar plans the real calculator, records tool evidence, formats the observed number, and verifies exact operands/result. Word problems, partial expressions and code artifacts are excluded. `27 × 14`, `19 × 6`, `84 ÷ 4` and wrong-result/wrong-operand regressions pass; no phrase-specific production fixtures were added.
9. Planner capacity shortages became generic FAILED/security messages. They now persist NEEDS_CAPABILITY, while materially ambiguous objectives persist NEEDS_INPUT before spending inference or tool capacity.
10. UI evidence extraction recursively promoted unvisited navigation/advertising links to sources and could hide the second source behind a twelve-link limit. The UI now shares the verifier's observed, completed, read-only browser evidence extraction. Three persisted-view regressions exclude unvisited links and failed reads. The original current-language journey and two new analogous objectives were rerun.

Production code contains no acceptance-phrase exceptions. The controlled preload is an explicit, isolated test process; application code never imports it. Synthetic provider responses and capability histories are labelled controlled and never counted as real model performance.

## Architecture and policy

GoalContract → requirements → dimensional floor → eligible candidates → physical inference/tool attempts → ObjectiveVerifier → durable objective state → UI remains the governing chain. EXECUTION_FINISHED is not OBJECTIVE_VERIFIED. Fresh/current goals require observed browser evidence, and unavailable independent verification never becomes success.

Policy remains `STRONG_FREE_CLOUD → OTHER_FREE_CLOUD → PAID_DISABLED → LOCAL_EMERGENCY`, with paid escalation disabled and bounded local fallback. Local cannot displace adequate free cloud; capability, every required quality dimension and workload compatibility remain mandatory. Missing acceptable capacity produces NEEDS_CAPABILITY, rather than a weaker answer presented as verified.

The floor considers reasoning, planning, coding, research, synthesis, tool use, structured output, verification and freshness/evidence. The current-language goal resolves HIGH / 0.71 and records dimensional gaps and rejection reasons. Provider/model/phase attribution, physical attempts versus logical operation, cooldowns, shadow cost and reduced-capacity fallback remain auditable.

Premium layout/CSS direction is preserved. Home remains objective/progress/result/evidence; routing diagnostics are secondary disclosure in Resources and mission detail. Provider placement is explicit CLOUD/LOCAL/UNKNOWN; local availability does not claim measured health, quota or capability. UNKNOWN remains UNKNOWN.

Security, approval gates, browser SSRF/DNS pinning, prompt-injection boundary, leases, checkpoint/reconciliation truth, SQLite durability, missions versus WorkRun, settlement/revenue truth and localhost-only binding were not relaxed. No economic external mutation, application/submission, payment, wallet/trading/x402 or fabricated settlement was performed. Real monetary cost and realized revenue remain zero.

## Technical and visual qualification

Frozen install and all 17 required gates passed on the final application code: build, typecheck, test; Control Center typecheck/test/build/smoke/security-smoke/supervisor-smoke; browser/web-evals/autonomy/hardening/opportunities/approvals/work-loop/marketplace real smoke. Root tests include cloud-first, quality-floor, capacity-aware, GoalContract, ObjectiveVerifier, product acceptance and real browser/security evidence checks.

The integration has its own `validate-v05-final-integration` workflow, including the full gate set and controlled supervisor/UI acceptance; `visual-qa-control-center` also targets this branch. Fresh remote run results and the exact final head are recorded in the qualification manifest; source-branch green runs are not used as an integration result.

Visual QA covers Home, Missions, Mission Detail, Opportunities, Work, Decisions, Resources, Memory, History and Settings, including populated-state interactions. Desktop 1440×1000, notebook 1366×768 and mobile 390×844 were inspected. The populated fixture journey is explicitly marked test data and makes no real semantic model claim.

Final visual diagnostics: `{"consoleErrors": 0, "pageErrors": 0, "requestFailures": 0, "benignPrefetchAborts": 532, "benignNavigationAborts": 0, "benignRscStreamAborts": 3, "horizontalOverflows": 0, "interactionFailures": 0}`. Only observed same-origin navigation/prefetch/RSC cancellations meeting the existing strict classifier are separated; HTTP errors and unclassified failures remain failures. Backend public-source failures described below are real and are not hidden in the benign counts.

## Actual product acceptance through the visible Control Center

All objectives below were submitted through the actual production supervisor and UI form, with fixtures disabled and real browser/inference paths. No internal execution function substituted for the user journey. Every terminal state was checked against the command card, then refreshed.

| Case | Objective | Persisted objective status | Result (possibly unverified) | Seconds | Shadow cost |
|---|---|---|---|---:|---:|
| golden-short | Responda apenas OK. | SUCCEEDED | OK | 1.56 | $0.000000 |
| golden-math | Calcule 27 vezes 14. | SUCCEEDED | 378 | 0.97 | $0.000000 |
| golden-current-ranking | Qual a linguagem de programação mais usada hoje? | NEEDS_CAPABILITY | — | 26.33 | $0.000000 |
| golden-python | Qual é a versão estável atual do Python? | NEEDS_CAPABILITY | — | 3.97 | $0.000000 |
| golden-node | Qual é a versão LTS atual do Node.js? | FAILED | — | 2.85 | $0.000000 |
| golden-methodology | Compare duas fontes atuais sobre popularidade de linguagens e explique por que os rankings diferem. | FAILED | — | 2.01 | $0.000000 |
| golden-code | Escreva uma função TypeScript uniqueById que preserve a primeira ocorrência e aceite objetos com id string. | NEEDS_CAPABILITY | — | 2.54 | $0.000000 |
| golden-plan | Planeje em cinco etapas uma migração de arquivos CSV para SQLite, incluindo validação, backup e rollback. | NEEDS_CAPABILITY | — | 1.97 | $0.000000 |
| trivial-word | Responda apenas PRONTO. | SUCCEEDED | PRONTO | 1.00 | $0.000000 |
| trivial-format | Retorne somente JSON válido com os campos cidade igual Recife e país igual Brasil. | NEEDS_CAPABILITY | — | 2.48 | $0.000000 |
| text-transform | Converta para letras maiúsculas: amanhã teremos uma reunião. | NEEDS_CAPABILITY | — | 3.59 | $0.003462 |
| math-simple | Quanto é 63 dividido por 7? | SUCCEEDED | 9 | 0.93 | $0.000000 |
| math-multistep | Calcule (18 + 7) vezes 4, depois subtraia 13. Mostre as etapas. | NEEDS_CAPABILITY | — | 1.81 | $0.000000 |
| math-word | Uma caixa tem 12 lápis. Comprei 4 caixas e dei 9 lápis. Quantos restaram? | NEEDS_CAPABILITY | — | 1.74 | $0.000000 |
| static-fact | Qual é a capital do Canadá? | NEEDS_CAPABILITY | — | 1.86 | $0.000000 |
| static-concept | Explique em até quatro frases a diferença entre concorrência e paralelismo. | NEEDS_CAPABILITY | — | 2.55 | $0.000000 |
| current-software | Qual é a versão estável atual do PostgreSQL? Cite a fonte oficial e a data observada. | FAILED | — | 2.88 | $0.000000 |
| current-comparison | Compare as versões estáveis atuais de Python e Node.js usando os sites oficiais; diferencie stable de LTS. | NEEDS_CAPABILITY | — | 5.25 | $0.000000 |
| research-one | Consulte a documentação oficial de SQLite e explique o que WAL faz, citando a fonte. | FAILED | — | 1.68 | $0.000000 |
| research-two | Pesquise nos sites oficiais de SQLite e PostgreSQL como cada um descreve transações e sintetize as diferenças. | FAILED | — | 2.19 | $0.000000 |
| research-disagreement | Compare TIOBE e Stack Overflow atuais sobre linguagens: explique metodologia e por que os resultados podem discordar. | FAILED | — | 1.46 | $0.000000 |
| code-function | Escreva em TypeScript uma função que receba números e devolva média ou null para lista vazia. | NEEDS_CAPABILITY | — | 1.53 | $0.000000 |
| code-debug | Corrija este TypeScript e explique o bug: const sum = (xs: number[]) => xs.reduce((a,b) => a+b); deve retornar 0 para lista vazia. | NEEDS_CAPABILITY | — | 0.63 | $0.000000 |
| code-refactor | Refatore sem mudar comportamento: function f(x:number){if(x>0){return x*2;}else{return x*2;}} | NEEDS_CAPABILITY | — | 1.49 | $0.000000 |
| code-reasoning | Implemente um cache LRU em TypeScript com capacidade fixa, get e set em O(1), sem dependências, e explique os invariantes. | NEEDS_CAPABILITY | — | 1.52 | $0.000000 |
| plan-simple | Faça um plano de três etapas para organizar documentos digitais pessoais. | NEEDS_CAPABILITY | — | 1.46 | $0.000000 |
| plan-constraints | Planeje uma apresentação em duas horas: pesquisa no máximo 30 minutos, ensaio no mínimo 20, sem ferramentas pagas. | NEEDS_CAPABILITY | — | 1.51 | $0.000000 |
| reason-comparison | Compare backup completo e incremental para um pequeno escritório, incluindo recuperação e custo operacional. | NEEDS_CAPABILITY | — | 1.54 | $0.000000 |
| reason-tradeoff | Explique o tradeoff entre cache com TTL curto e longo quando precisão importa mais que latência. | NEEDS_CAPABILITY | — | 1.49 | $0.000000 |
| reason-decision | Escolha entre SQLite e PostgreSQL para um app offline de um usuário, priorizando durabilidade e operação simples; declare premissas. | NEEDS_CAPABILITY | — | 0.71 | $0.000000 |
| browser-tool | Abra https://www.python.org/downloads/ e descreva apenas a versão de Python observada, com a fonte. | NEEDS_CAPABILITY | — | 2.43 | $0.000000 |
| tool-recovery | Pesquise a política de versões LTS de Node.js; se uma fonte falhar, tente outra fonte oficial. | FAILED | — | 1.66 | $0.000000 |
| ambiguity-answerable | Qual linguagem devo aprender primeiro para automatizar pequenas tarefas no meu computador? Declare uma premissa razoável. | NEEDS_CAPABILITY | — | 1.48 | $0.000000 |
| ambiguity-blocked | Compare isso. | NEEDS_INPUT | — | 0.64 | $0.000000 |
| persistence | Dê três recomendações para backups locais seguros, numeradas de 1 a 3. | NEEDS_CAPABILITY | — | 1.51 | $0.000000 |
| planning-extra | Planeje a investigação de um incidente de latência sem alterar produção, separando hipóteses, observação e validação. | NEEDS_CAPABILITY | — | 1.47 | $0.000000 |
| evidence-analog-a | Compare a popularidade atual de linguagens de programação, distinguindo métricas e citando as fontes observadas. | NEEDS_CAPABILITY | — | 6.95 | $0.000000 |
| evidence-analog-b | Qual linguagem de programação é mais usada atualmente? Compare indicadores e explique diferenças. | NEEDS_CAPABILITY | — | 5.18 | $0.000000 |

Counts: `{"SUCCEEDED": 4, "NEEDS_CAPABILITY": 26, "FAILED": 7, "NEEDS_INPUT": 1}`. A blocked objective may retain a produced draft; that draft is not a verified success. In an earlier real round, the text transformation had a successful OVH producer, but insufficient independent verification capacity kept it blocked. That evidence is retained separately; the final round had no successful cloud producer and the table/metrics above are authoritative.

## Most important golden journey

Objective: **Qual a linguagem de programação mais usada hoje?**

GoalContract:
```json
{
  "version": 1,
  "normalizedObjective": "Qual a linguagem de programação mais usada hoje?",
  "primaryIntent": "COMPARISON",
  "domain": "software-development",
  "freshness": "CURRENT",
  "evidenceRequirement": "REQUIRED",
  "requiredCapabilities": [
    "web-research",
    "browser-read",
    "comparison",
    "citations",
    "reasoning"
  ],
  "ambiguityLevel": "MEDIUM",
  "clarificationRequired": false,
  "successCriteria": [
    {
      "id": "answer-objective",
      "description": "The result directly answers the operator's objective.",
      "required": true,
      "kind": "CONTENT"
    },
    {
      "id": "current-evidence",
      "description": "Use at least 2 observed external sources.",
      "required": true,
      "kind": "EVIDENCE"
    },
    {
      "id": "explain-comparison",
      "description": "Explain the comparison metric and material differences rather than presenting an unsupported winner.",
      "required": true,
      "kind": "CONTENT"
    },
    {
      "id": "requested-format",
      "description": "Respect the requested result format and language.",
      "required": true,
      "kind": "FORMAT"
    }
  ],
  "expectedResultKind": "COMPARISON",
  "qualityTarget": "HIGH",
  "minimumEvidenceSources": 2,
  "analysisMethod": "hybrid"
}
```

Floor:
```json
{
  "taskId": "task_mQKK8IDy0DBxkuIVUPqp1",
  "taskType": "chat",
  "level": "HIGH",
  "minimumOverall": 0.71,
  "dimensions": {
    "reasoning": 0.71,
    "planning": 0.71,
    "research": 0.71,
    "synthesis": 0.71,
    "freshnessEvidence": 0.71,
    "verification": 0.68
  },
  "reasons": [
    "qualityTarget=HIGH",
    "complexity=0.127",
    "freshness=CURRENT",
    "evidence=REQUIRED:2"
  ]
}
```

Actual observed browser sources:
```json
[
  {
    "url": "https://www.tiobe.com/tiobe-index/",
    "title": "TIOBE Index - TIOBE"
  },
  {
    "url": "https://pypl.github.io/PYPL.html",
    "title": "PYPL PopularitY of Programming Language index"
  }
]
```

Rejected candidates and recorded gaps:
```json
{
  "taskId": "task_mQKK8IDy0DBxkuIVUPqp1",
  "taskType": "chat",
  "qualityFloor": {
    "level": "HIGH",
    "minimumOverall": 0.71,
    "dimensions": {
      "reasoning": 0.71,
      "planning": 0.71,
      "research": 0.71,
      "synthesis": 0.71,
      "freshnessEvidence": 0.71,
      "verification": 0.68
    },
    "reasons": [
      "qualityTarget=HIGH",
      "complexity=0.127",
      "freshness=CURRENT",
      "evidence=REQUIRED:2"
    ]
  },
  "rejectedCandidates": [
    {
      "provider": "ovh",
      "model": "Meta-Llama-3_3-70B-Instruct",
      "tier": "OTHER_FREE_CLOUD",
      "reasons": [
        "quality-floor:overall=0.683<0.710",
        "quality-floor:research=0.708<0.710",
        "quality-floor:synthesis=0.683<0.710",
        "quality-floor:freshnessEvidence=0.703<0.710"
      ]
    },
    {
      "provider": "ovh",
      "model": "gpt-oss-120b",
      "tier": "OTHER_FREE_CLOUD",
      "reasons": [
        "quality-floor:overall=0.683<0.710",
        "quality-floor:research=0.708<0.710",
        "quality-floor:synthesis=0.683<0.710",
        "quality-floor:freshnessEvidence=0.703<0.710"
      ]
    },
    {
      "provider": "ai-horde",
      "model": "anonymous-worker-pool",
      "tier": "OTHER_FREE_CLOUD",
      "reasons": [
        "quality-floor:overall=0.683<0.710",
        "quality-floor:reasoning=0.648<0.710",
        "quality-floor:planning=0.683<0.710",
        "quality-floor:research=0.683<0.710",
        "quality-floor:synthesis=0.683<0.710",
        "quality-floor:freshnessEvidence=0.703<0.710"
      ]
    }
  ]
}
```

The product recognizes “hoje”, requires current evidence and a metric-dependent comparison, and opens the substantive TIOBE/PYPL pages through the protected browser. The observations preserve page titles, visible content and actual source URLs; navigation links are not evidence. The ranking is not reduced to an invented universal winner. However, no quality-qualified producer/verifier combination is available here, so synthesis does not complete and ObjectiveVerifier records NEEDS_CAPABILITY. The UI shows blocked/unverified, never SUCCEEDED. This golden journey is **not green** and prevents product qualification. Python current-version research is likewise blocked; Node LTS and several general discovery cases fail to obtain adequate public-source content. Coding and multi-step planning golden journeys are blocked. Only the literal OK and real 27×14 golden journeys verified.

## Controlled failure/recovery, refresh and restart

24 controlled supervisor/UI journeys passed. This proves integration behavior under defined faults, not the intelligence of a live cloud model. Bad neighbor/refusal/empty/incomplete/format/code/unsupported-claim cases never become SUCCEEDED. The missing-current-evidence case is rejected at the browser/evidence boundary here, before a producer can fabricate success.

| Controlled case | Expected result | Observed |
|---|---|---|
| bad-neighbor | reject | PASS; FAILED; groq |
| neighbor-analog-a | reject | PASS; FAILED; groq |
| neighbor-analog-b | reject | PASS; FAILED; groq |
| format-analog-a | reject | PASS; FAILED; gemini |
| format-analog-b | reject | PASS; FAILED; gemini |
| bad-current-no-evidence | reject | PASS; FAILED; None |
| bad-refusal | reject | PASS; FAILED; gemini |
| bad-empty | reject | PASS; FAILED; gemini |
| bad-incomplete | reject | PASS; FAILED; groq |
| bad-format | reject | PASS; FAILED; gemini |
| bad-code | reject | PASS; FAILED; groq |
| bad-unsupported-claim | reject | PASS; FAILED; groq |
| cloud-first | verified / prescribed routing or persistence | PASS; SUCCEEDED; groq |
| cloud-provider-recovery | verified / prescribed routing or persistence | PASS; SUCCEEDED; gemini |
| provider-timeout | verified / prescribed routing or persistence | PASS; SUCCEEDED; gemini |
| efficient-trivial-cloud | verified / prescribed routing or persistence | PASS; SUCCEEDED; gemini |
| efficiency-analog-a | verified / prescribed routing or persistence | PASS; SUCCEEDED; gemini |
| efficiency-analog-b | verified / prescribed routing or persistence | PASS; SUCCEEDED; gemini |
| difficult-quality-floor | verified / prescribed routing or persistence | PASS; SUCCEEDED; groq |
| local-emergency | verified / prescribed routing or persistence | PASS; SUCCEEDED; ollama |
| local-inadequate | reject | PASS; NEEDS_CAPABILITY; gemini |
| no-capability | reject | PASS; NEEDS_CAPABILITY; None |
| refresh-during-mission | verified / prescribed routing or persistence | PASS; SUCCEEDED; groq |
| checkpoint-restart-resume | verified / prescribed routing or persistence | PASS; SUCCEEDED; groq |

Recovery between clouds, provider timeout, qualified local emergency, inadequate local rejection, efficient adequate trivial cloud and difficult-floor rejection all pass. Every successful semantic case has a distinct producer/verifier. The refresh journey must receive its terminal verified state without manual navigation. The crash journey observes an in-flight persisted attempt, kills only its supervised child, restarts the same database, resumes from the UI checkpoint button, and verifies the resumed result in the UI. Safe shutdown, pause/resume and a second restart preserve the result. The real, unmocked calculator result 378 also survives refresh, UI safe shutdown and production restart; pause/resume is tested via the real panel.

## Metrics and limits

```json
{
  "objectives": 38,
  "status": {
    "SUCCEEDED": 4,
    "NEEDS_CAPABILITY": 26,
    "FAILED": 7,
    "NEEDS_INPUT": 1
  },
  "mission_success_rate": 0.10526315789473684,
  "objective_verified_rate": 0.10526315789473684,
  "false_success_rate": 0,
  "actual_cloud_producer_successes": 0,
  "actual_cloud_verified_mission_successes": 0,
  "cloud_first_accuracy": null,
  "local_emergency_accuracy": null,
  "needs_capability_accuracy": null,
  "monetary_cost": 0,
  "shadow_cost": 0.0034620000000000002,
  "human_intervention_rate": 0.02631578947368421,
  "runtime_metrics_count": 36,
  "runtime_aggregate": {
    "freshness_routing_accuracy": 1,
    "tool_selection_accuracy": 0.944444,
    "evidence_coverage": 0.916667,
    "provider_failure_recovery": 0,
    "recovery_success_rate": null
  },
  "time_to_result_ms": {
    "mean": 2758.7105263157896,
    "median": 1669.0,
    "p95": 6948
  },
  "console_errors": 0,
  "page_errors": 0,
  "refresh_preserved": 38
}
```

Mission/objective rates use all actual objectives as the denominator. False success is zero observed, with successful literal/arithmetic answers checked; this is not a statistical guarantee about unavailable models. Runtime freshness/tool/evidence metrics use persisted metric observations; early planning/input blocks do not all emit that event and coverage/count are explicit. Freshness routing accuracy means the requirement was routed correctly, not that the mission succeeded. Recovery metrics exclude cases with no recovery opportunity. The controlled matrix has cloud-first/local-emergency/needs-capability/provider-recovery accuracy 100% over its applicable explicit cases, while live capacity/routing recovery qualification remains unavailable. Time-to-result includes UI terminal observation and refresh. Shadow costs are available per mission above; monetary cost is zero.

## Outstanding severity and readiness

- P0 open: 0 known; controlled false-success regressions are fixed and original/analog cases reject.
- P1 open: actual useful broad acceptance is blocked. No authenticated adequate free cloud or locally running qualified model is configured in this environment; keyless options provide insufficient high-floor evidence or fail operationally. Actual Node public browser navigation returns ERR_EMPTY_RESPONSE; general discovery can lack a safe distinct observed source. These are real failed golden/product journeys, not benign QA aborts or P2. The proxy-mediated pinned browser transport differs from ordinary proxied curl (which can reach Node); browser protections were not weakened to obtain a pass. Those source/recovery failures still require qualification with usable compute/network.
- P2: none newly accepted to lower the bar.

To unblock: configure an authorized adequate free cloud, repeat live routing and all blocked/failed golden and analogous journeys under a working protected browser network, and then repeat complete technical/visual/CI qualification. Do not pay, seed synthetic performance into production, lower floors, fake sources or reinterpret blocked missions as success.

```text
INTEGRATION_READY=true (technical integration only; requires fresh green remote workflows)
INFRASTRUCTURE_READY=true
PRODUCT_CORE_READY=false
CLOUD_FIRST_READY=true (policy/integration qualified; live provider acceptance incomplete)
LOCAL_EMERGENCY_ONLY=true
PREMIUM_UX_READY=true (visual qualification; requires fresh green remote workflow)
HUMAN_ACCEPTANCE_CANDIDATE=false
V0_5_CANDIDATE_READY_FOR_GUSTAVO=false
```
