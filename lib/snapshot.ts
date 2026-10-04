import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildFixture } from "./fixture";
import type { Snapshot } from "./types";

export async function loadSnapshot(): Promise<Snapshot> {
  const file = path.join(process.cwd(), "data", "snapshot.json");
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Snapshot;
    if (
      parsed &&
      (parsed.source === "nerda-historical" || parsed.source === "fixture") &&
      parsed.window &&
      parsed.comparison &&
      Array.isArray(parsed.feeders) &&
      parsed.feeders.length > 0
    ) {
      return parsed;
    }
  } catch {
    // A missing local snapshot means the page shows the worked example.
  }
  return buildFixture();
}
