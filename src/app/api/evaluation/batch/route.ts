import { evaluateSyntheticBatch } from "@/evaluation/batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const report = evaluateSyntheticBatch();

  return new Response(`${JSON.stringify(report, null, 2)}\n`, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": 'attachment; filename="returnsplit-engine-evaluation.json"',
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
