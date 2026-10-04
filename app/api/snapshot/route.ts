import { loadSnapshot } from "@/lib/snapshot";

export const revalidate = 60;

export async function GET() {
  const snapshot = await loadSnapshot();
  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
    },
  });
}
