import type { ModelDecisionView } from "../data/types";
import { EmptyState, formatTime } from "./ui";

export function ModelDecisionInspector({ decision }: { decision: ModelDecisionView | null | undefined }) {
  if (!decision) {
    return <EmptyState title="Nenhuma escolha de modelo registrada" detail="Não há dados suficientes. As escolhas aparecerão quando forem registradas pelo runtime." />;
  }

  return (
    <div className="decision-inspector">
      <div className="decision-selected">
        <div className="micro-label">SELECTED</div>
        <div className="decision-model">{decision.selectedLabel}</div>
        <div className="decision-utility"><span>UTILITY</span><strong>{decision.utility?.toFixed(2) ?? "—"}</strong></div>
      </div>
      <div className="decision-grid">
        <FactorList title="REASONS" sign="+" items={decision.reasons} />
        <FactorList title="PENALTIES" sign="−" items={decision.penalties} />
      </div>
      <div className="alternatives">
        <div className="micro-label">ALTERNATIVES</div>
        {decision.alternatives.length ? decision.alternatives.map((alternative) => (
          <div className="alternative-row" key={alternative.label}>
            <span>{alternative.label}</span>
            <strong>{alternative.utility?.toFixed(2) ?? "—"}</strong>
          </div>
        )) : <div className="muted">Nenhuma alternativa registrada.</div>}
      </div>
      <div className="decision-foot developer-only">decision {decision.id} · {formatTime(decision.decidedAt)} · {decision.provenance.toUpperCase()}</div>
    </div>
  );
}

function FactorList({ title, sign, items }: { title: string; sign: string; items: ModelDecisionView["reasons"] }) {
  return (
    <div>
      <div className="micro-label">{title}</div>
      <div className="factor-list">
        {items.length ? items.map((item) => (
          <div className="factor-row" key={item.label}>
            <span className={sign === "+" ? "plus" : "minus"}>{sign}</span>
            <span>{item.label}</span>
            <strong>{typeof item.value === "number" ? item.value.toFixed(2) : item.value}</strong>
          </div>
        )) : <div className="muted">Nenhum fator registrado.</div>}
      </div>
    </div>
  );
}
