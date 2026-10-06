# Streetprice

A map of a local energy price on SSEN low-voltage feeders across Oxford.

The price is a model: the Elexon Market Index Price, plus an add-on that pays a battery on that feeder to flatten it. It is not an SSEN tariff.

The area is the Oxford box, latitude 51.70–51.82 and longitude −1.32 to −1.15. `npm run ingest` keeps every feeder in that box with at least half of the half-hour buckets on the stored day, and leaves the rest out. Until that snapshot exists, the site shows a worked example for three Oxford substations.

## Develop

```
npm install
npm test
npm run dev
```

`npm run dev` and `npm run build` copy the MapLibre worker into `public/maplibre`. That directory stays out of git.

Copy `.env.example` to `.env.local` before `npm run discover` or `npm run ingest`. The NeRDA key stays out of git.

```
npm run streets
npm run discover
npm run ingest
```

`npm run streets` downloads OpenStreetMap roads for the box into gitignored `data/street-network.json`. Ingest reads `cohort.json`, fetches the historical day, and writes `data/snapshot.json`. Both files stay out of git. Feeders under 50% coverage are omitted. A bucket is kept only when all three phases reported; gaps are not filled in.
