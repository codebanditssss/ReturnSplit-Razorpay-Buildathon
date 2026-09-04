import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { getProviderIdentity } from "@/server/demo-runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ReturnSplit", template: "%s · ReturnSplit" },
  description: "A financial control layer for safe, explainable marketplace return reversals.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const provider = getProviderIdentity();
  return (
    <html lang="en">
      <body><AppShell providerMode={provider.mode} providerLabel={provider.label}>{children}</AppShell></body>
    </html>
  );
}
