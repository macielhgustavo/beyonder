# Beyonder Control Center

Local-first graphical control plane for Beyonder.

It reuses the useful parts of the old experimental dashboard:

- Next.js app setup
- `DashboardDataSource` boundary
- local SQLite read-only adapter
- redaction helpers
- audit, memory and router-decision views
- demo mode and tests

It intentionally discards the old read-only/developer-dashboard product shape. Normal operation now goes through human views and explicit commands:

- submit objective
- discover opportunities
- prepare application
- approve/reject action
- pause/resume runtime
- safe shutdown

The app binds to `127.0.0.1` and command endpoints reject non-local or cross-origin requests.

```bash
pnpm control-center
pnpm control-center:build
pnpm control-center:test
pnpm control-center:smoke
pnpm control-center:install-launcher
```

Normal use should start from Applications -> Beyonder after installing the launcher.

## Operação real e instalação

O modo normal usa classificação, memória, `LlmPlanner`, validação, roteador adaptativo,
executor, ferramentas e checkpoints existentes. Sem provider compatível ou plano válido,
a tarefa falha explicitamente. O registro `safe-objective` está disponível apenas quando
o runtime é criado em modo fixture. `BEYONDER_CONTROL_FIXTURE=1` habilita fixtures no
Control Center e mostra **DEMO / TEST DATA**; esse modo nunca é ativado como fallback.
Os testes não precisam de API keys e não fazem mutações externas.

```sh
pnpm install --frozen-lockfile
pnpm control-center:build
pnpm control-center:install-launcher
```

Depois abra Applications → Beyonder. O supervisor usa `next start`, porta fixa 4187 e
bind 127.0.0.1. Ele mantém um PID exclusivo, reutiliza a instância existente, recupera
PID obsoleto, verifica a saúde e informa colisões sem encerrar processos alheios. O log
fica em `$XDG_RUNTIME_DIR/beyonder-control/control-center.log` (fallback: cache do usuário).
`pnpm control-center:launch -- --restart` solicita parada segura antes de reiniciar.
O desenvolvimento continua com `pnpm control-center`.

Para tarefas que usam navegador, instale o Chromium do Playwright:

```sh
pnpm --filter @beyonder/browser-agent exec playwright install chromium
```

A parada segura bloqueia trabalho novo, aguarda operações em andamento e a persistência
dos checkpoints, fecha sessões de navegador e responde à requisição. Só depois da
resposta o supervisor envia SIGTERM ao processo Next, que fecha os handles SQLite.
A parada de emergência sinaliza cancelamento das tarefas e fecha navegadores; chamadas
atômicas de modelo/ferramenta podem terminar antes do próximo ponto seguro. Pausar bloqueia
novos objetivos, discovery, candidaturas, submissões e confirmações. Tarefas em andamento
aguardam em estado WAITING antes do próximo passo e preservam o último checkpoint de recuperação; retomar libera a continuação.

O heartbeat é escrito a cada 2 segundos pelo processo servidor. Depois de 10 segundos
sem resposta o painel mostra Degradado; depois de 60 segundos mostra Offline, mesmo que
o banco ainda exista. O painel consulta o estado a cada 3 segundos.

## Ações externas e receita

Os adapters padrão são manuais. Aprovação autoriza uma ação; não prova que ela aconteceu.
Sem adapter real, o trabalho fica em `MANUAL_APPLICATION_REQUIRED` ou
`MANUAL_SUBMISSION_REQUIRED`. A confirmação humana grava `ExternalActionEvidence`, com
ator HUMAN, fonte vinculada ao trabalho, referência/notas opcionais e timestamp do servidor,
e consome a aprovação. Confirmações repetidas ou sem aprovação são rejeitadas.
Adapters fixture só são selecionados com a opção explícita `fixture: true` no runtime.
Adapters não classificados como reais também exigem ação manual.

A página Trabalhos exibe candidatura, execução, entrega, submissão e pagamento.
Receita realizada só aparece com evidência válida de settlement. A confirmação de envio
mantém receita em zero. O formulário de pagamento exige valor positivo, USD/USDC, fonte e
referência externa. Valores de fixtures não entram na receita real do painel. A Home
separa recebido, estimado em trabalhos e simulado.

Credenciais usam a allowlist do catálogo e o vault criptografado. O frontend não recebe
segredos salvos. A validação usa endpoints de leitura do provider; READY exige validação
bem-sucedida. Credenciais validadas ficam disponíveis na memória da sessão. Após reiniciar,
configure novamente a chave pela UI ou use as variáveis de ambiente existentes; desbloqueio
persistente do vault para inferência ainda não está implementado.

## Validação oficial

Os dois typechecks são obrigatórios: `pnpm typecheck` valida o backend, e
`pnpm control-center:typecheck` valida o projeto Next separado.
O workflow `.github/workflows/validate-control-center.yml` roda ambos, regressões do backend,
testes/build do painel, fixture smoke, security smoke e supervisor smoke. Também roda todos
os smokes de browser, autonomia, hardening, oportunidades, approvals, work-loop e marketplaces.

```sh
pnpm control-center:test
pnpm control-center:smoke
pnpm control-center:security-smoke
pnpm control-center:supervisor-smoke
```

O smoke do supervisor exige a porta 4187 livre, Chromium instalado e build de produção prévio. Também opera a UI pelo Playwright: objetivo, resultado, preparação e autorização de candidatura fixture. Ele testa colisão
com processo alheio, PID obsoleto, heartbeat READY, reutilização da instância, resultado
fixture visível, pause/resume, parada real e reinício sem lock obsoleto. Custo monetário: $0.

Após encerramento inesperado, tarefas em andamento são apresentadas como interrompidas, nunca como trabalho ativo de um processo que já terminou. Os checkpoints permanecem disponíveis no stack de recuperação; retomada automática após reinício ainda não está implementada.
