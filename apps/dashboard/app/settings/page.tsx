import { CommandButton, ShutdownButton } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { PageHeader } from "../../components/ui";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <DashboardShell>
      <PageHeader title="Settings" eyebrow="LOCAL CONTROL" description="Preferências locais e controles avançados. Operações de risco ficam deliberadamente longe da superfície principal." />

      <div className="settings-stack">
        <section className="settings-section">
          <header><div><span className="eyebrow">GENERAL</span><h2>Local behavior</h2></div><p>Configurações do Control Center nesta máquina.</p></header>
          <div className="settings-rows">
            <div className="settings-row">
              <div><strong>Iniciar junto com o computador</strong><span>Cria ou remove um autostart em nível de usuário. Default OFF.</span></div>
              <div className="action-row"><CommandButton payload={{ type: "setStartup", enabled: true }}>Ativar</CommandButton><CommandButton payload={{ type: "setStartup", enabled: false }} tone="quiet">Desativar</CommandButton></div>
            </div>
            <div className="settings-row">
              <div><strong>Notificações locais</strong><span>Alertas são exibidos enquanto esta página está aberta; nenhuma entrega externa é inferida.</span></div>
              <span className="settings-readonly">runtime-defined</span>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <header><div><span className="eyebrow">DEVELOPER</span><h2>Diagnostic detail</h2></div><p>Expõe IDs e traces técnicos sem mudar o comportamento do runtime.</p></header>
          <div className="settings-rows">
            <div className="settings-row">
              <div><strong>Developer Mode</strong><span>Mostra detalhes técnicos, IDs e JSON onde a UI possui disclosure específico.</span></div>
              <div className="action-row"><CommandButton payload={{ type: "setDeveloperMode", enabled: true }}>Ativar</CommandButton><CommandButton payload={{ type: "setDeveloperMode", enabled: false }} tone="quiet">Desativar</CommandButton></div>
            </div>
          </div>
        </section>

        <section className="settings-section settings-danger-zone">
          <header><div><span className="eyebrow">RUNTIME CONTROL</span><h2>Shutdown</h2></div><p>Controles com impacto no processo em execução.</p></header>
          <div className="settings-rows">
            <div className="settings-row">
              <div><strong>Parada segura</strong><span>Solicita shutdown depois de salvar o estado atual.</span></div>
              <ShutdownButton />
            </div>
            <div className="settings-row settings-row-danger">
              <div><strong>Parada de emergência</strong><span>Pausa imediatamente o Control Center e registra um evento crítico. Use apenas em falha grave.</span></div>
              <CommandButton payload={{ type: "emergencyStop" }} tone="danger" confirm="Emergency stop pausa imediatamente o Control Center e registra um evento crítico. Use apenas se algo estiver errado.">Parada de emergência</CommandButton>
            </div>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
