import { loadSnapshot } from "@/lib/snapshot";

export async function GET() {
  const snapshot = await loadSnapshot();
  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
