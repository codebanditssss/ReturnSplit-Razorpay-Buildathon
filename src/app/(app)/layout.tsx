import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getProviderIdentity } from "@/server/demo-runtime";

export default function AppGroupLayout({ children }: Readonly<{ children: ReactNode }>) {
  const provider = getProviderIdentity();
  return (
    <AppShell providerMode={provider.mode} providerLabel={provider.label}>
      {children}
    </AppShell>
  );
}
