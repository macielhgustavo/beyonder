import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, ProvenanceNotice, formatTime } from "../../components/ui";
import { getDashboardDataSource, type MemoryKind } from "../../data";

export const dynamic = "force-dynamic";
const kinds: Array<MemoryKind | "all"> = ["all", "working", "episodic", "semantic", "procedural", "economic"];

export default async function MemoryPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const search = typeof params?.q === "string" ? params.q : "";
  const requestedKind = typeof params?.kind === "string" ? params.kind : "all";
  const kind = kinds.includes(requestedKind as MemoryKind | "all") ? requestedKind as MemoryKind | "all" : "all";
  const source = getDashboardDataSource();
  const memories = await source.getMemories({ search, kind, limit: 50 });

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader eyebrow="MEMORY / READ-ONLY" title="Memory" description="Inspect working, episodic, semantic, procedural and economic context. Editing and deletion are intentionally disabled." />
      <ProvenanceNotice provenance={source.provenance} />
      <Panel title="Memory explorer" meta={`${memories.length} loaded`}>
        <form className="filter-bar" method="get"><input name="q" defaultValue={search} placeholder="Search memory content or keywords" aria-label="Search memories" /><select name="kind" defaultValue={kind} aria-label="Filter by memory kind">{kinds.map((item) => <option key={item} value={item}>{item}</option>)}</select><button type="submit">Filter</button></form>
        {memories.length ? <div className="memory-list">{memories.map((memory) => <article className="memory-row" key={memory.id}><div className="memory-kind">{memory.kind}</div><div className="memory-content"><strong>{memory.content}</strong><div className="memory-meta"><span>importance {memory.importance ?? "—"}</span><span>utility {memory.utility?.toFixed(2) ?? "—"}</span><span>confidence {memory.confidence?.toFixed(2) ?? "—"}</span><span>access {memory.accessCount}</span><span>{formatTime(memory.createdAt)}</span></div>{memory.keywords.length ? <div className="tag-row">{memory.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div> : null}</div></article>)}</div> : <EmptyState title="No memories found" detail="The memory store is empty, unavailable, or no records match the current filters." />}
      </Panel>
    </DashboardShell>
  );
}
