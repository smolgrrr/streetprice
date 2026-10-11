import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildFixture } from "./fixture";
import type { Snapshot } from "./types";
import transformerRatings from "../data/transformer-ratings.json";
import { annualWindow } from "./annual-capacity";

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
      if (parsed.source === "nerda-historical") {
        parsed.transformerRatings = transformerRatings.sites as Snapshot["transformerRatings"];
        try {
          const annual = JSON.parse(await readFile(path.join(process.cwd(), "data", "annual-capacity.json"), "utf8")) as Snapshot["annualCapacity"];
          const expected = annualWindow(new Date(parsed.window.end));
          if (annual?.method === "mean-daily-absolute-maxima" && annual.coverageRule && annual.feeders && annual.substations
            && annual.window.start === expected.start.toISOString() && annual.window.end === expected.end.toISOString()) {
            parsed.annualCapacity = annual;
            try {
              const sizing = JSON.parse(await readFile(path.join(process.cwd(), "data", "sizing-curves.json"), "utf8")) as Snapshot["sizing"];
              if (sizing?.window.start === annual.window.start && sizing.window.end === annual.window.end) parsed.sizing = sizing;
            } catch { /* Annual profile still renders when sizing curves are absent. */ }
          }
        } catch {
          // No annual data is not a licence to invent a future rating.
        }
      }
      try {
        parsed.constraintModel = JSON.parse(await readFile(modelFile, "utf8")) as Snapshot["constraintModel"];
        const search = JSON.parse(await readFile(searchFile, "utf8")) as { status: string; selectedDay: string | null; selectedDayCoverage?: number | null; feederCountRequested: number };
        if (parsed.constraintModel) {
          parsed.constraintModel.search = parsed.windowMode === "previous-24h" || parsed.windowMode === "latest-available-24h" ? {
            requestedMonths: 12, status: "Rolling 24-hour display; pressure-day search not used", selectedDay: null, coverage: null,
          } : {
            requestedMonths: 12,
            status: search.selectedDay
              ? `${search.status}: ${search.selectedDay} selected with ${Math.round((search.selectedDayCoverage ?? 0) * 100)}% feeder coverage`
              : `${search.status}: no day met the coverage rule`,
            selectedDay: search.selectedDay,
            coverage: search.selectedDayCoverage ?? null,
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
