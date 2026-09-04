import Link from "next/link";
import { Icon } from "@/components/icons";

export default function NotFound() {
  return <div className="page page-narrow"><div className="card"><div className="empty-state"><h1 style={{ color: "var(--text)", fontSize: 20, margin: "0 0 8px" }}>Claim not found</h1><p style={{ margin: "0 0 18px" }}>This claim may have been removed or the reference is incorrect.</p><Link className="button secondary" href="/claims"><Icon name="arrow-left" /> Back to claims</Link></div></div></div>;
}
