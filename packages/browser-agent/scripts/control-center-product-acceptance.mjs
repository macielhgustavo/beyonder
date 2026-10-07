import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

// Human objectives live only in this acceptance harness. The product is unmodified
// and every objective is submitted through the visible Control Center form.
const objectives = [
  ["golden-short", "Responda apenas OK."],
  ["golden-math", "Calcule 27 vezes 14."],
  ["golden-current-ranking", "Qual a linguagem de programação mais usada hoje?"],
  ["golden-python", "Qual é a versão estável atual do Python?"],
  ["golden-node", "Qual é a versão LTS atual do Node.js?"],
  ["golden-methodology", "Compare duas fontes atuais sobre popularidade de linguagens e explique por que os rankings diferem."],
  ["golden-code", "Escreva uma função TypeScript uniqueById que preserve a primeira ocorrência e aceite objetos com id string."],
  ["golden-plan", "Planeje em cinco etapas uma migração de arquivos CSV para SQLite, incluindo validação, backup e rollback."],
  ["trivial-word", "Responda apenas PRONTO."],
  ["trivial-format", "Retorne somente JSON válido com os campos cidade igual Recife e país igual Brasil."],
  ["text-transform", "Converta para letras maiúsculas: amanhã teremos uma reunião."],
  ["math-simple", "Quanto é 63 dividido por 7?"],
  ["math-multistep", "Calcule (18 + 7) vezes 4, depois subtraia 13. Mostre as etapas."],
  ["math-word", "Uma caixa tem 12 lápis. Comprei 4 caixas e dei 9 lápis. Quantos restaram?"],
  ["static-fact", "Qual é a capital do Canadá?"],
  ["static-concept", "Explique em até quatro frases a diferença entre concorrência e paralelismo."],
  ["current-software", "Qual é a versão estável atual do PostgreSQL? Cite a fonte oficial e a data observada."],
  ["current-comparison", "Compare as versões estáveis atuais de Python e Node.js usando os sites oficiais; diferencie stable de LTS."],
  ["research-one", "Consulte a documentação oficial de SQLite e explique o que WAL faz, citando a fonte."],
  ["research-two", "Pesquise nos sites oficiais de SQLite e PostgreSQL como cada um descreve transações e sintetize as diferenças."],
  ["research-disagreement", "Compare TIOBE e Stack Overflow atuais sobre linguagens: explique metodologia e por que os resultados podem discordar."],
  ["code-function", "Escreva em TypeScript uma função que receba números e devolva média ou null para lista vazia."],
  ["code-debug", "Corrija este TypeScript e explique o bug: const sum = (xs: number[]) => xs.reduce((a,b) => a+b); deve retornar 0 para lista vazia."],
  ["code-refactor", "Refatore sem mudar comportamento: function f(x:number){if(x>0){return x*2;}else{return x*2;}}"],
  ["code-reasoning", "Implemente um cache LRU em TypeScript com capacidade fixa, get e set em O(1), sem dependências, e explique os invariantes."],
  ["plan-simple", "Faça um plano de três etapas para organizar documentos digitais pessoais."],
  ["plan-constraints", "Planeje uma apresentação em duas horas: pesquisa no máximo 30 minutos, ensaio no mínimo 20, sem ferramentas pagas."],
  ["reason-comparison", "Compare backup completo e incremental para um pequeno escritório, incluindo recuperação e custo operacional."],
  ["reason-tradeoff", "Explique o tradeoff entre cache com TTL curto e longo quando precisão importa mais que latência."],
  ["reason-decision", "Escolha entre SQLite e PostgreSQL para um app offline de um usuário, priorizando durabilidade e operação simples; declare premissas."],
  ["browser-tool", "Abra https://www.python.org/downloads/ e descreva apenas a versão de Python observada, com a fonte."],
  ["tool-recovery", "Pesquise a política de versões LTS de Node.js; se uma fonte falhar, tente outra fonte oficial."],
  ["ambiguity-answerable", "Qual linguagem devo aprender primeiro para automatizar pequenas tarefas no meu computador? Declare uma premissa razoável."],
  ["ambiguity-blocked", "Compare isso."],
  ["persistence", "Dê três recomendações para backups locais seguros, numeradas de 1 a 3."],
  ["planning-extra", "Planeje a investigação de um incidente de latência sem alterar produção, separando hipóteses, observação e validação."],
  ["evidence-analog-a", "Compare a popularidade atual de linguagens de programação, distinguindo métricas e citando as fontes observadas."],
  ["evidence-analog-b", "Qual linguagem de programação é mais usada atualmente? Compare indicadores e explique diferenças."]
];

const base = process.env.CONTROL_CENTER_URL ?? "http://127.0.0.1:4190";
const output = process.env.ACCEPTANCE_DIR ?? "/tmp/beyonder-product-acceptance";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const report = { base, fixture: false, startedAt: new Date().toISOString(), cases: [], consoleErrors: [], pageErrors: [] };
page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
page.on("pageerror", (error) => report.pageErrors.push(String(error)));
const save = () => fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
try {
  await page.goto(base);
  const onboarding = page.locator('[data-command="completeFirstRun"]');
  if (await onboarding.count()) { await onboarding.click(); await page.locator("#objective").waitFor(); }
  for (const [category, objective] of objectives) {
    const started = Date.now();
    const entry = { category, objective };
    try {
      await page.goto(base);
      await page.locator("#objective").fill(objective);
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST");
      await page.locator('.objective-box button[type="submit"]').click();
      const response = await responsePromise;
      const queued = await response.json();
      if (!queued.ok || !queued.taskId) throw new Error(JSON.stringify(queued));
      entry.taskId = queued.taskId;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const payload = await (await page.request.get(`${base}/api/control/missions/${queued.taskId}`)).json();
        const mission = payload.mission;
        if (["succeeded", "failed", "blocked", "cancelled"].includes(mission?.status) && mission.objectiveStatus && mission.completedAt && mission.executionPhase !== "EXECUTING") { entry.mission = mission; break; }
        await page.waitForTimeout(500);
      }
      if (!entry.mission) throw new Error("Mission never reached a persisted terminal objective state");
      const card = page.locator(`.command-mission [data-mission-id="${queued.taskId}"]`);
      await card.waitFor();
      await page.waitForFunction(({ taskId, status }) => document.querySelector(`.command-mission [data-mission-id="${taskId}"]`)?.getAttribute("data-state") === status, { taskId: queued.taskId, status: entry.mission.status });
      entry.uiText = await card.innerText();
      await page.screenshot({ path: path.join(output, `${category}.png`), fullPage: true });
      await page.reload();
      await page.waitForFunction(({ id, status, objectiveStatus, verified }) => {
        const card = document.querySelector(`.command-mission [data-mission-id="${id}"]`);
        return card?.getAttribute("data-state") === status
          && card.getAttribute("data-objective-status") === objectiveStatus
          && card.getAttribute("data-result-verified") === String(verified);
      }, { id: queued.taskId, status: entry.mission.status, objectiveStatus: entry.mission.objectiveStatus, verified: entry.mission.resultVerified });
      const refreshed = (await (await page.request.get(`${base}/api/control/missions/${queued.taskId}`)).json()).mission;
      entry.refreshPreserved = refreshed?.objectiveStatus === entry.mission.objectiveStatus
        && refreshed.resultVerified === entry.mission.resultVerified && refreshed.result === entry.mission.result;
      if (entry.mission.resultVerified) {
        const visibleResult = await page.locator(`.command-mission [data-mission-id="${queued.taskId}"] .mission-result p`).textContent();
        entry.refreshPreserved &&= visibleResult === entry.mission.result;
      }
      if (!entry.refreshPreserved) throw new Error("Persisted result or authoritative Home state changed across refresh");
    } catch (error) { entry.harnessError = String(error); }
    entry.timeToResultMs = Date.now() - started;
    report.cases.push(entry);
    await save();
    console.log(JSON.stringify({ category, taskId: entry.taskId, status: entry.mission?.status, objectiveStatus: entry.mission?.objectiveStatus, timeToResultMs: entry.timeToResultMs, error: entry.harnessError }));
  }
} finally { report.completedAt = new Date().toISOString(); await save(); await browser.close(); }
