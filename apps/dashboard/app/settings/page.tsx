import { CommandButton, ShutdownButton } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { PageHeader, Panel } from "../../components/ui";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <DashboardShell>
      <PageHeader title="Configuracoes" eyebrow="LOCAL" description="Preferencias locais, modo desenvolvedor e controles avancados. Opcoes perigosas ficam fora da Home." />
      <div className="grid-main">
        <Panel title="Geral">
          <div className="settings-list">
            <div><strong>Iniciar junto com o computador</strong><span>Cria ou remove um autostart user-level. Default OFF.</span><div className="action-row"><CommandButton payload={{ type: "setStartup", enabled: true }}>Ativar</CommandButton><CommandButton payload={{ type: "setStartup", enabled: false }} tone="quiet">Desativar</CommandButton></div></div>
            <div><strong>Notificacoes</strong><span>Alertas locais aparecem quando a pagina esta aberta.</span></div>
          </div>
        </Panel>
        <Panel title="Developer Mode">
          <p className="muted">Quando ligado, detalhes tecnicos, IDs e JSON ficam visiveis nos paineis de trace.</p>
          <div className="action-row">
            <CommandButton payload={{ type: "setDeveloperMode", enabled: true }}>Ativar</CommandButton>
            <CommandButton payload={{ type: "setDeveloperMode", enabled: false }} tone="quiet">Desativar</CommandButton>
          </div>
        </Panel>
      </div>
      <Panel title="Parar Beyonder" className="spaced-panel">
        <p className="muted">O Beyonder vai parar após salvar o estado atual. A parada de emergência é reservada para falhas graves.</p>
        <div className="action-row">
          <ShutdownButton />
          <CommandButton payload={{ type: "emergencyStop" }} tone="danger" confirm="Emergency stop pausa imediatamente o Control Center e registra um evento critico. Use apenas se algo estiver errado.">Parada de emergência</CommandButton>
        </div>
      </Panel>
    </DashboardShell>
  );
}
