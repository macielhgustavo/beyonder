import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, StatusBadge, formatPercent, formatTime } from "../../components/ui";
import { getDashboardDataSource, type MemoryKind } from "../../data";

export const dynamic = "force-dynamic";

const kinds: MemoryKind[] = ["episodic", "procedural", "economic", "semantic", "working"];

export default async function MemoryPage() {
  const source = getDashboardDataSource();
  const memories = await source.getMemories({ limit: 100 });
  const populatedKinds = kinds.filter((kind) => memories.some((memory) => memory.kind === kind));

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="Memory" eyebrow="MEMORY ENGINE" description="Conhecimento persistido por categoria, com procedência, confiança e utilidade observáveis. Secrets continuam fora desta superfície." />
      <div className="page-facts memory-facts">
        <span><strong>{memories.length}</strong> memórias visíveis</span>
        <span><strong>{populatedKinds.length}</strong> categorias ativas</span>
        <span><strong>{memories.filter((memory) => memory.kind === "working").length}</strong> working</span>
      </div>

      {memories.length ? (
        <div className="memory-archive">
          {populatedKinds.map((kind) => {
            const group = memories.filter((memory) => memory.kind === kind);
            return (
              <section className="memory-section" key={kind}>
                <header className="memory-section-head">
                  <div><span className="eyebrow">CATEGORY</span><h2>{kind}</h2></div>
                  <span>{group.length}</span>
                </header>
                <div className="memory-list">
                  {group.map((memory) => (
                    <article className="memory-row" key={memory.id}>
                      <div className="memory-kind"><StatusBadge status={kind === "economic" ? "good" : kind === "working" ? "info" : "neutral"}>{kind}</StatusBadge></div>
                      <div className="memory-content">
                        <strong>{memory.content}</strong>
                        <dl className="memory-meta">
                          <div><dt>source</dt><dd>{memory.source ?? "runtime"}</dd></div>
                          <div><dt>confidence</dt><dd>{formatPercent(memory.confidence)}</dd></div>
                          <div><dt>utility</dt><dd>{formatPercent(memory.utility)}</dd></div>
                          <div><dt>updated</dt><dd>{formatTime(memory.lastAccessedAt ?? memory.createdAt)}</dd></div>
                        </dl>
                        {memory.keywords.length ? <div className="tag-row">{memory.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : <EmptyState title="Nenhuma memória ainda" detail="A memória aparece quando tarefas, decisões e resultados forem persistidos pelo runtime." />}
    </DashboardShell>
  );
}
