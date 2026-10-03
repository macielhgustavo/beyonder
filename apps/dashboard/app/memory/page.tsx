import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, StatusBadge, formatPercent, formatTime } from "../../components/ui";
import { getDashboardDataSource, type MemoryKind } from "../../data";

export const dynamic = "force-dynamic";

const kinds: MemoryKind[] = ["episodic", "procedural", "economic", "semantic", "working"];

export default async function MemoryPage() {
  const source = getDashboardDataSource();
  const memories = await source.getMemories({ limit: 100 });

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="Memoria" eyebrow="MEMORY ENGINE" description="Memoria humana por categoria, com source, confianca e utilidade sem expor secrets." />
      <Panel title="Memorias" meta={`${memories.length} visiveis`}>
        {memories.length ? (
          <div className="memory-tabs">
            {kinds.map((kind) => {
              const group = memories.filter((memory) => memory.kind === kind);
              if (!group.length) return null;
              return (
                <section className="memory-section" key={kind}>
                  <h2>{kind}</h2>
                  <div className="memory-list">
                    {group.map((memory) => (
                      <article className="memory-row" key={memory.id}>
                        <div className="memory-kind"><StatusBadge status={kind === "economic" ? "good" : "neutral"}>{kind}</StatusBadge></div>
                        <div className="memory-content">
                          <strong>{memory.content}</strong>
                          <div className="memory-meta">
                            <span>source: {memory.source ?? "runtime"}</span>
                            <span>confidence: {formatPercent(memory.confidence)}</span>
                            <span>utility: {formatPercent(memory.utility)}</span>
                            <span>updated: {formatTime(memory.lastAccessedAt ?? memory.createdAt)}</span>
                          </div>
                          {memory.keywords.length ? <div className="tag-row">{memory.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : <EmptyState title="Nenhuma memoria ainda" detail="A memoria aparece quando tarefas, decisoes e resultados forem registrados." />}
      </Panel>
    </DashboardShell>
  );
}
