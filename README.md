# Streetprice

A map of a local energy price on SSEN low-voltage feeders around Oxford.

The price is a model: the Elexon Market Index Price, plus an add-on that pays a battery on that feeder to flatten it. It is not an SSEN tariff.

Until a reviewed `cohort.json` is ingested, the site shows a worked example for two Oxford substations.

## Develop

```
npm install
npm test
npm run dev
```

`npm run dev` and `npm run build` copy the MapLibre worker into `public/maplibre`. That directory stays out of git.

Copy `.env.example` to `.env.local` before `npm run discover`. The NeRDA key stays out of git.
