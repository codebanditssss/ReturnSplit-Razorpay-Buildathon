import { getDemoRuntime } from "@/server/demo-runtime";

export const dynamic = "force-dynamic";

export function GET() {
  const { provider } = getDemoRuntime();
  return Response.json({
    ok: true,
    mode: provider.mode,
    label: provider.label,
    connectionStatus: provider.mode === "demo" ? "simulator_ready" : "adapter_configured_not_probed",
    checkedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
