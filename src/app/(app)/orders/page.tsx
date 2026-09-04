import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icons";
import { Money, PageHeader, StatusPill } from "@/components/ui";
import { claimOperationPresentation } from "@/lib/claim-operation-presentation";
import { orders, sellers } from "@/lib/data";
import { getDemoClaimsView } from "@/server/demo-runtime";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const sellerNames = new Map(sellers.map((seller) => [seller.id, seller.name]));

function sellerSummary(sellerIds: readonly string[]): string {
  const names = [...new Set(sellerIds.map((id) => sellerNames.get(id) ?? "Unknown seller"))];
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
}

function dateOnly(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export default async function OrdersPage() {
  const claims = await getDemoClaimsView();
  const rows = orders.map((order) => {
    const claim = claims.find((entry) => entry.orderId === order.id);
    const status = claim
      ? claimOperationPresentation(claim)
      : { label: "No return", tone: "neutral" as const, detail: undefined };
    return {
      order,
      claim,
      status,
      sellers: sellerSummary(order.lines.map((line) => line.sellerId)),
    };
  });

  return (
    <div className="page">
      <PageHeader title="Orders" description="Original payments, line ownership, and linked-account transfers." />
      <div className="table-card mobile-card-table-wrap" role="region" aria-label="Orders with return claims">
        <table className="data-table mobile-card-table">
          <caption className="sr-only">Orders and their linked return claims</caption>
          <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Seller</th><th scope="col">Paid</th><th scope="col">Claim</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{rows.map(({ order, claim, sellers: sellerLabel, status }) => <tr key={order.id}>
            <th scope="row" data-label="Order"><span className="table-primary">{order.reference}</span><span className="table-secondary">{dateOnly(order.placedAt)}</span></th>
            <td data-label="Customer"><div className="cust-identity"><Avatar name={order.customer.name} size={32} /><span className="table-primary">{order.customer.name}</span></div></td>
            <td data-label="Seller">{sellerLabel}</td><td data-label="Paid"><Money paise={order.capturedPaymentPaise} /></td>
            <td data-label="Claim"><span className="mono">{claim?.reference ?? "-"}</span></td><td data-label="Status"><div className="operation-state"><StatusPill tone={status.tone} icon={claim ? undefined : "package"}>{status.label}</StatusPill>{status.detail && <span className="table-secondary operation-detail">{status.detail}</span>}</div></td>
            <td data-label="Open">{claim && <Link href={`/claims/${claim.reference}`} className="row-link">View claim <Icon name="chevron-right" /></Link>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
