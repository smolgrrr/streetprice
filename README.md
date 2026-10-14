# Streetprice

A 24-hour feeder chart and loading heat map for SSEN low-voltage feeders across Oxford. The site compares observed flow with a simulated home-battery response and a proposed feeder size.

The area is the Oxford box, latitude 51.70–51.82 and longitude −1.32 to −1.15. The production snapshot retains 187 feeders and 85 substations, including missing readings. The deployed site serves `data/snapshot.json`; if missing, it shows a labelled synthetic example.

## Develop

```
npm ci
npm test
npm run dev
```

`npm run dev` and `npm run build` copy the MapLibre worker into `public/maplibre`. That directory stays out of git.

Copy `.env.example` to `.env.local` before `npm run discover` or `npm run ingest`. The NeRDA key stays out of git.

```
npm run streets
npm run discover
npm run ingest
npm run annual
```

`npm run ingest` requests the previous 24 hours ending at the last completed half-hour. If SSEN returns no readings, it checks the prior 30 days and uses the latest available 24-hour window, explicitly labelled. It leaves the previous snapshot intact on authentication/fetch failure. `NERDA_WINDOW_START` remains an explicit historical override. Street traces are reused from the saved snapshot or generated from gitignored `data/street-network.json`.

`npm run annual` derives compact annual statistics and `data/sizing-curves.json` for the twelve complete London calendar months before the displayed window ends. The annual statistics retain mean daily import/export peaks and require 50% half-hour coverage per day, 90% covered days per year, and 75% per calendar-month portion. The sizing curves use the recorded half-hours to find the smallest feasible capacity at each battery adoption level (0–60 homes), carrying a feasible battery charge range across the recorded year. Missing observations are excluded rather than filled. `npm run sizing` regenerates only the sizing curves from the local cache; no NeRDA credentials are needed when the cache is complete.

The same compact file preserves one curated worst-observed-day trace per feeder, selected by maximum import/export loading relative to today's assumed directional limits among days with ≥50% readings. Missing and ambiguous repeated DST times remain gaps. The initially selected feeder has adequate annual history and a peak nearest 100%; this selection is independent of the battery toggle. Batteries assume 10 kW / 25 kWh per home. Raw annual histories remain local and ignored by git.

Figure 1 shows the selected feeder’s latest 24 hours and worst observed day. The battery toggle replaces those traces with simulated battery response targeting the proposed capacity at the selected adoption rate. The map shows selected-time loading against today’s assumed import/export limits in both modes; proposed capacity is never used as the map’s 100% reference. Tap a feeder on the map to change Figure 1. Battery ownership, charging cost, degradation, reliability, voltage and future growth are outside this illustration. Annual ingestion publishes compact outputs without publishing raw histories.

Substation statistics sum concurrent monitored feeder readings before taking maxima. They are not total transformer demand without full inventory coverage. The model retains its experimental price, battery and linear-cost assumptions.

Commit the compact snapshot, annual statistics and sizing curves for deployment, never raw history, ingest caches, cohort discovery or credentials. Local annual pages in `data/annual-cache/` are gitignored and reusable. A power bucket requires all three phases; gaps are never filled in.
