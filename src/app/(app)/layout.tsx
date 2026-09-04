import { AppShell } from "@/components/app-shell";
import { getProviderIdentity } from "@/server/demo-runtime";

export default function AppGroupLayout({ children }: LayoutProps<"/">) {
  const provider = getProviderIdentity();
  return (
    <AppShell providerMode={provider.mode} providerLabel={provider.label}>
      {children}
    </AppShell>
  );
}
