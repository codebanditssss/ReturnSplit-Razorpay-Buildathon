import type { Metadata } from "next";
import { Icon } from "@/components/icons";
import { Card, PageHeader, StatusPill } from "@/components/ui";
import { orders, policies } from "@/lib/data";
import type { ReturnReason } from "@/lib/types";

export const metadata: Metadata = { title: "Policies" };

const reasonLabels: Record<ReturnReason, string> = {
  manufacturing_defect: "Manufacturing defect",
  wrong_item: "Wrong item",
  courier_damage: "Courier damage",
  not_as_described: "Not as described",
  customer_remorse: "Customer remorse",
  unknown: "Unknown reason",
};

function dateOnly(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function PoliciesPage() {
  const currentPolicy = policies.find((policy) => !policy.effectiveTo) ?? policies[0];
  const sellerLiableRules = currentPolicy.rules.sellerLiableReasons.map((reason) => ({
    reason: reasonLabels[reason],
    seller: "Net settled item value",
    marketplace: "Returned commission",
    shipping: currentPolicy.rules.refundOutboundShippingOnPartialReturn ? "Refunded on partial return" : "Not refunded on partial return",
  }));
  const rules = [
    ...sellerLiableRules,
    {
      reason: reasonLabels.courier_damage,
      seller: "Requires liability review",
      marketplace: "Calculated after review",
      shipping: currentPolicy.rules.refundOutboundShippingOnPartialReturn ? "Refunded on partial return" : "Not refunded on partial return",
    },
    {
      reason: reasonLabels.customer_remorse,
      seller: "No automated reversal",
      marketplace: currentPolicy.rules.customerRemorseRefundable ? "Refundable" : "Not refundable",
      shipping: "No automated refund plan",
    },
  ];

  return (
    <div className="page page-narrow">
      <PageHeader title="Policies" description="Versioned liability rules frozen to the order date." />
      <div className="workbench-main">
        <Card title={`${currentPolicy.name} v${currentPolicy.version}`} description={`Effective ${dateOnly(currentPolicy.effectiveFrom)} · Current version`} action={<StatusPill tone="active">Active</StatusPill>}>
          <div className="callout info"><Icon name="lock" /><div><strong>Published rules are immutable</strong><p>Changes create a new version. Existing orders continue using the version active when they were placed.</p></div></div>
          <div style={{ marginTop: 18 }} className="table-card mobile-card-table-wrap" role="region" aria-label="Policy rules">
            <table className="data-table mobile-card-table info-card-table">
              <caption className="sr-only">Funding rules in {currentPolicy.name} version {currentPolicy.version}</caption>
              <thead><tr><th scope="col">Reason</th><th scope="col">Seller funds</th><th scope="col">Marketplace funds</th><th scope="col">Shipping</th></tr></thead>
              <tbody>{rules.map((rule) => <tr key={rule.reason}><th scope="row" data-label="Reason"><span className="table-primary">{rule.reason}</span></th><td data-label="Seller funds">{rule.seller}</td><td data-label="Marketplace funds">{rule.marketplace}</td><td data-label="Shipping">{rule.shipping}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
        <Card title="Policy history" description="Every decision retains the exact source clause and version.">
          <div className="settings-list">
            {policies.map((policy) => {
              const linkedOrders = orders.filter((order) => order.policyId === policy.id).length;
              return <div className="settings-row" key={policy.id}><div><strong>{policy.name} v{policy.version}</strong><p>{dateOnly(policy.effectiveFrom)}{policy.effectiveTo ? ` – ${dateOnly(policy.effectiveTo)}` : " onward"} · {linkedOrders} linked order{linkedOrders === 1 ? "" : "s"}</p></div><StatusPill tone={policy.effectiveTo ? "neutral" : "active"}>{policy.effectiveTo ? "Archived" : "Active"}</StatusPill></div>;
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
