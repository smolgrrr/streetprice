# Streetprice

A map of a local energy price on SSEN low-voltage feeders across Oxford.

The price is a model: the Elexon Market Index Price, plus an add-on that pays a battery on that feeder to flatten it. It is not an SSEN tariff.

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

Figure 1 shows the selected feeder’s latest 24 hours and its worst observed day; the battery toggle replaces original traces with simulated response to the dynamically sized limit. Historical P50/P90/P99 can be opened separately. Figure 2 sorts annual flow magnitudes from busiest to quietest and moves the proposed line with battery adoption. The economics panel compares annualised installed capacity with an energy-only VPP payment. The illustrative tariff is annual marginal asset cost per kW divided by the recorded hours above proposed capacity. This is not a market-clearing price or proof that VPPs would participate; battery ownership, charging, degradation, reliability, voltage and future growth remain outside the cost comparison. Annual ingestion publishes compact outputs without publishing raw histories.

Substation statistics sum concurrent monitored feeder readings before taking maxima. They are not total transformer demand without full inventory coverage. The model retains its experimental price, battery and linear-cost assumptions.

Commit the compact snapshot, annual statistics and sizing curves for deployment, never raw history, ingest caches, cohort discovery or credentials. Local annual pages in `data/annual-cache/` are gitignored and reusable. A power bucket requires all three phases; gaps are never filled in.
