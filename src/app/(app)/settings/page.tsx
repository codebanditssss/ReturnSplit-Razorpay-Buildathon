import type { Metadata } from "next";
import Link from "next/link";
import { ConnectionPanel } from "@/components/connection-panel";
import { DemoScenarios } from "@/components/demo-scenarios";
import { Icon } from "@/components/icons";
import { Card, PageHeader, StatusPill } from "@/components/ui";
import { getProviderIdentity } from "@/server/demo-runtime";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  const provider = getProviderIdentity();
  return (
    <div className="page page-narrow">
      <PageHeader title="Settings" description="Provider connection, approval controls, and assurance." />
      <div className="workbench-main">
        <Card title="Payment connection" description={provider.mode === "demo" ? "The local simulator cannot move live money." : "The configured adapter accepts Razorpay Test Mode credentials only."}>
          <ConnectionPanel initialMode={provider.mode} initialLabel={provider.label} />
        </Card>
        {provider.mode === "demo" && <details className="card demo-tools">
          <summary><span><strong>Demo tools</strong><small>Reset this session and open a seeded workflow</small></span><Icon name="chevron-right" /></summary>
          <div className="card-body"><DemoScenarios /></div>
        </details>}
        <div className="split-grid">
          <Card title="Approval controls" description="Guardrails applied before execution.">
            <div className="check-list">
              <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>Human approval required for every reversal plan</span></div>
              <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>Plan hash invalidates approval when inputs change</span></div>
              <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>Manual policy overrides are disabled</span></div>
              <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>Unknown provider outcomes pause for reconciliation</span></div>
            </div>
          </Card>
          <Card title="Controls & evidence" description="Synthetic safety checks and forecast evidence-not production accuracy.">
            <div className="settings-list">
              <div className="settings-row"><div><strong>Money invariants</strong><p>Seeded allocation and state-transition tests</p></div><StatusPill tone="active">10,000 trials</StatusPill></div>
              <div className="settings-row"><div><strong>Duplicate side effects</strong><p>Replay and idempotency scenarios</p></div><span className="money">0</span></div>
              <div className="settings-row"><div><strong>Full methodology</strong><p>Review controls, limitations, and benchmark design</p></div><Link className="row-link" href="/evaluation">View evidence <Icon name="arrow-right" /></Link></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
