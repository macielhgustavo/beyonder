# Beyonder

Beyonder é um runtime experimental para agentes autônomos orientados a objetivos, com foco em execução verificável, aquisição de capacidade computacional e uso responsável de ferramentas externas.

O projeto nasceu para explorar uma pergunta prática: **como construir um agente que não apenas gera respostas, mas executa trabalho real, mede o que aconteceu e evita declarar sucesso quando o objetivo não foi cumprido?**

## Visão geral

O Beyonder organiza execução autônoma em torno de objetivos, capacidades, ferramentas, provedores de IA e evidências de resultado. Em vez de tratar uma chamada de modelo como sinônimo de conclusão, o runtime separa planejamento, execução, verificação e estado final.

Entre os principais pontos do projeto estão:

- execução de objetivos por etapas;
- seleção e roteamento entre diferentes provedores de IA;
- política de compute com prioridade para recursos de baixo custo;
- ferramentas de navegador, shell e filesystem protegidas por políticas;
- benchmark de modelos e provedores;
- avaliação de tarefas reais e testes de autonomia;
- persistência local com SQLite;
- mecanismos para reduzir **false success**, isto é, casos em que um agente afirma ter concluído algo sem evidência suficiente.

## Arquitetura

O repositório é organizado como um monorepo TypeScript.

```text
apps/
  cli/               interface de linha de comando

packages/
  runtime/           loop principal de execução
  compute/           seleção e aquisição de capacidade computacional
  economy/           estado econômico e políticas relacionadas
  tools/             ferramentas disponíveis ao agente
  benchmark/         benchmark e avaliação de modelos
  browser-agent/     automação e políticas de navegador
  web-evals/         avaliações de tarefas e autonomia

tests/
  integration/       testes de integração do runtime
```

## Stack

- TypeScript
- Node.js 22+
- pnpm workspaces
- SQLite
- better-sqlite3
- Drizzle ORM
- Vitest
- Zod
- Commander

## Como executar

Requisitos:

- Node.js 22 ou superior
- pnpm 9 ou superior

Instale as dependências:

```bash
pnpm install
```

Valide o projeto:

```bash
pnpm typecheck
pnpm test
```

Alguns comandos disponíveis:

```bash
pnpm beyonder status
pnpm beyonder economy
pnpm beyonder run "Verifique o runtime sem efeitos externos" --steps 1
```

## Provedores e compute

O Beyonder possui uma camada própria para descoberta, inventário e roteamento de provedores.

```bash
pnpm beyonder providers autopilot
pnpm beyonder providers resume
pnpm beyonder providers inventory
pnpm beyonder providers discover
pnpm beyonder providers status
```

Também existem atalhos equivalentes via scripts do `package.json`.

## Testes e avaliações

A suíte cobre diferentes partes do sistema separadamente:

```bash
pnpm test:compute
pnpm test:tools
pnpm test:runtime
pnpm test:benchmark
pnpm test:browser
pnpm test:web-evals
pnpm test:integration
```

O projeto também possui smokes específicos para autonomia, oportunidades, marketplace, approvals e work loop.

## Segurança

Ferramentas com efeitos externos não são assumidas como seguras por padrão. Shell, navegador e filesystem são controlados por políticas, e dados como secrets, cookies, sessões, bancos locais, arquivos `.env` e cofres de provedores ficam fora do versionamento.

O objetivo é que o agente consiga evoluir em capacidade sem transformar autonomia em execução irrestrita.

## O que este projeto demonstra

Este projeto concentra principalmente trabalho em:

- arquitetura de agentes;
- sistemas modulares em TypeScript;
- integração com múltiplos provedores de IA;
- persistência e observabilidade de execução;
- desenho de políticas de segurança;
- testes de comportamento autônomo;
- avaliação de confiabilidade de sistemas baseados em LLMs.

## Status

Em desenvolvimento ativo. A arquitetura e as políticas continuam evoluindo conforme novos fluxos reais de execução são testados.
