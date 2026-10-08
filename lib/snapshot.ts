import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildFixture } from "./fixture";
import type { Snapshot } from "./types";

export async function loadSnapshot(): Promise<Snapshot> {
  const file = path.join(process.cwd(), "data", "snapshot.json");
  const modelFile = path.join(process.cwd(), "data", "constraint-model.json");
  const searchFile = path.join(process.cwd(), "data", "constraint-search-result.json");
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
      try {
        parsed.constraintModel = JSON.parse(await readFile(modelFile, "utf8")) as Snapshot["constraintModel"];
        const search = JSON.parse(await readFile(searchFile, "utf8")) as { status: string; selectedDay: string | null; eligibleFeederCount: number; feederCountRequested: number };
        if (parsed.constraintModel) {
          parsed.constraintModel.search = {
            requestedMonths: 12,
            status: `${search.status}: ${search.eligibleFeederCount}/${search.feederCountRequested} feeders met the coverage rule`,
            selectedDay: search.selectedDay,
            coverage: search.feederCountRequested ? search.eligibleFeederCount / search.feederCountRequested : null,
          };
        }
      } catch {
        // Older deployments can still render the snapshot without model metadata.
      }
      return parsed;
    }
  } catch {
    // A missing local snapshot means the page shows the worked example.
  }
  return buildFixture();
}
