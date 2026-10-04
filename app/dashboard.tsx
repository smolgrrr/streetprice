"use client";

import { useEffect, useMemo, useState } from "react";
import { SeriesChart } from "@/components/charts";
import { PriceMap } from "@/components/price-map";
import { addonColor, ratioColor } from "@/lib/color";
import { swing } from "@/lib/comparison";
import { formatCurrencyPrice, formatKw, formatPct, formatPrice, formatStamp, formatTime } from "@/lib/format";
import { substationsOf } from "@/lib/group";
import { localToWholesale, type PricedSample } from "@/lib/price";
import { streetLayout } from "@/lib/street-trace";
import type { Feeder, Snapshot } from "@/lib/types";

const HALF_HOUR_MS = 30 * 60 * 1000;

function clockOf(snapshot: Snapshot): string[] {
  const start = Date.parse(snapshot.window.start);
  const end = Date.parse(snapshot.window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  return Array.from(
    { length: Math.round((end - start) / HALF_HOUR_MS) },
    (_, index) => new Date(start + index * HALF_HOUR_MS).toISOString(),
  );
}

function sampleAt(feeder: Feeder, t: string | undefined): PricedSample | undefined {
  return t ? feeder.samples.find((sample) => sample.t === t) : undefined;
}

function strongestFeeder(feeders: Feeder[]): Feeder | undefined {
  return feeders.reduce<Feeder | undefined>((best, feeder) => {
    const feederSwing = swing(feeder.samples.map((sample) => sample.addon));
    const bestSwing = best ? swing(best.samples.map((sample) => sample.addon)) : -1;
    return feederSwing > bestSwing ? feeder : best;
  }, undefined);
}

function stateOf(sample: PricedSample | undefined, cap: number): "Charge" | "Balanced" | "Discharge" | "No reading" {
  if (!sample) return "No reading";
  if (sample.addon > cap * 0.05) return "Discharge";
  if (sample.addon < -cap * 0.05) return "Charge";
  return "Balanced";
}

function qualityLabel(feeder: Feeder): string {
  return feeder.quality.status === "good" ? "Good coverage" : feeder.quality.status === "partial" ? "Partial coverage" : "Insufficient";
}

function ratioHeadline(ratio: number | null): string {
  if (ratio === null) return "Wholesale prices were flat, so a comparison ratio is not available.";
  return `The modelled local grid signal moved prices ${ratio.toFixed(1)}× as much as wholesale.`;
}

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [substationId, setSubstationId] = useState<string | null>(null);
  const [feederId, setFeederId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/snapshot")
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as Snapshot;
      })
      .then((data) => {
        if (cancelled) return;
        const chosen = strongestFeeder(data.feeders) ?? data.feeders[0];
        const clock = clockOf(data);
        const selectedThrough = chosen?.samples.at(-1)?.t ?? data.window.dataThrough;
        const through = clock.findLastIndex((t) => t <= selectedThrough);
        setSnapshot(data);
        setIndex(Math.max(0, through));
        setSubstationId(chosen?.substationId ?? null);
        setFeederId(chosen?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("The pilot snapshot could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const feeders = useMemo(() => snapshot?.feeders ?? [], [snapshot]);
  const groups = useMemo(() => substationsOf(feeders), [feeders]);
  const layout = useMemo(
    () =>
      streetLayout(
        feeders.map((item) => ({
          id: item.id,
          substationId: item.substationId,
          lat: item.lat,
          lon: item.lon,
        })),
      ),
    [feeders],
  );
  const clock = useMemo(() => (snapshot ? clockOf(snapshot) : []), [snapshot]);
  const cursorTime = clock[index];
  const substation = groups.find((group) => group.id === substationId) ?? groups[0];
  const feeder =
    substation?.feeders.find((item) => item.id === feederId) ?? strongestFeeder(substation?.feeders ?? []);
  const sample = feeder ? sampleAt(feeder, cursorTime) : undefined;

  function selectSubstation(id: string) {
    const group = groups.find((item) => item.id === id);
    const chosen = strongestFeeder(group?.feeders ?? []);
    setSubstationId(id);
    setFeederId(chosen?.id ?? null);
  }

  function selectFeeder(nextSubstationId: string, nextFeederId: string) {
    setSubstationId(nextSubstationId);
    setFeederId(nextFeederId);
  }

  if (error) {
    return (
      <main className="status">
        <p className="brand">Streetprice</p>
        <h1>We could not load the Oxford pilot.</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!snapshot || !feeder || !substation || clock.length === 0) {
    return (
      <main className="status">
        <p className="brand">Streetprice</p>
        <h1>Loading the Oxford pilot…</h1>
      </main>
    );
  }

  const cap = snapshot.capGbpPerMwh;
  const state = stateOf(sample, cap);
  const stateColor = sample ? addonColor(sample.addon, cap) : "#9aa3ab";
  const averageCoverage =
    feeders.reduce((sum, item) => sum + item.quality.completeness, 0) / Math.max(1, feeders.length);
  const sampleByTime = new Map(feeder.samples.map((item) => [item.t, item]));
  const selectedClockSamples = clock.map((t) => sampleByTime.get(t));
  const points = groups.map((group) => ({
    id: group.id,
    name: group.name,
    lat: group.lat,
    lon: group.lon,
    selected: group.id === substation.id,
  }));
  const lines = layout.traces.map((trace) => {
    const item = feeders.find((feederItem) => feederItem.id === trace.feederId);
    const reading = item ? sampleAt(item, cursorTime) : undefined;
    const ratio = reading ? localToWholesale(reading.local, reading.wholesale) : null;
    return {
      feederId: trace.feederId,
      substationId: trace.substationId,
      coordinates: trace.coordinates,
      color: ratio === null ? "#c5c8cc" : ratioColor(ratio),
      selected: trace.feederId === feeder.id,
    };
  });

  return (
    <main className="story">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Streetprice home">Streetprice</a>
      </header>

      <section className="intro section" id="top">
        <h1>Oxford street price</h1>
        <div className="intro-row">
          <div>
            <p className="lede">
              A model of how local grid conditions could change the wholesale electricity price across
              one tightly grouped Oxford neighbourhood.
            </p>
            <p className="lede finding" id="pilot-result">{ratioHeadline(snapshot.comparison.ratio)}</p>
          </div>
          <p className="as-of">As of {formatStamp(snapshot.window.dataThrough)}</p>
        </div>
        {snapshot.source === "fixture" ? (
          <p className="data-banner">
            The local NeRDA snapshot is unavailable, so this page is showing a clearly labelled synthetic example.
          </p>
        ) : null}
      </section>

      <section className="hero section" aria-labelledby="pilot-result">
        <div className="map-column">
          <div className="map-card">
            <PriceMap
              points={points}
              lines={lines}
              stubs={layout.stubs}
              onSelectSubstation={selectSubstation}
              onSelectFeeder={selectFeeder}
            />
            <div className="map-legend" aria-label="Local price divided by wholesale">
              <span>0.5×</span>
              <i className="ratio-scale" />
              <span>2×</span>
              <span className="scale-caption">Local ÷ wholesale</span>
            </div>
          </div>
          <div className="location-switcher" role="group" aria-label="Choose a substation">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={group.id === substation.id ? "location on" : "location"}
                onClick={() => selectSubstation(group.id)}
                aria-pressed={group.id === substation.id}
              >
                {group.name}
              </button>
            ))}
          </div>
        </div>
        <dl className="hero-metrics">
          <Metric label="Local price swing" value={`£${formatPrice(snapshot.comparison.localSwingGbpPerMwh)}`} unit="/MWh" />
          <Metric label="Wholesale swing" value={`£${formatPrice(snapshot.comparison.wholesaleSwingGbpPerMwh)}`} unit="/MWh" />
          <Metric label="Local ÷ wholesale" value={snapshot.comparison.ratio === null ? "–" : `${snapshot.comparison.ratio.toFixed(1)}×`} />
          <Metric label="Feeders analysed" value={String(snapshot.comparison.feederCount)} />
        </dl>
      </section>

      <section className="section comparison-section" aria-labelledby="comparison-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">One day, one feeder</p>
            <h2 id="comparison-title">Local price vs wholesale</h2>
          </div>
          <div className="chart-key" aria-label="Chart legend">
            <span><i className="key-line local" />Modelled local</span>
            <span><i className="key-line wholesale" />Wholesale</span>
          </div>
        </div>
        <div className="chart-card">
          <SeriesChart
            cursor={index}
            ariaLabel={`Modelled local and wholesale price for ${substation.name} ${feeder.name} over 24 hours`}
            series={[
              { values: selectedClockSamples.map((item) => item?.local ?? null), color: "#171a20", width: 2.5 },
              { values: selectedClockSamples.map((item) => item?.wholesale ?? null), color: "#8e8e8e", width: 2, dash: "7 6" },
            ]}
          />
          <div className="chart-axis" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
          <div className="time-control">
            <div>
              <span>Explore the day</span>
              <strong>{cursorTime ? formatStamp(cursorTime) : "–"}</strong>
            </div>
            <input
              type="range"
              min={0}
              max={clock.length - 1}
              value={index}
              aria-label="Time of day"
              aria-valuetext={cursorTime ? formatStamp(cursorTime) : ""}
              onChange={(event) => setIndex(Number(event.target.value))}
            />
          </div>
        </div>
      </section>

      <section className="section feeder-section" aria-labelledby="feeder-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Look under the bonnet</p>
            <h2 id="feeder-title">Feeder detail</h2>
          </div>
          <p className="section-note">Select a feeder to see what drives its modelled price.</p>
        </div>
        <div className="feeder-layout">
          <nav className="feeder-nav" aria-label={`Feeders at ${substation.name}`}>
            <p className="nav-title">{substation.name}</p>
            {substation.feeders.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === feeder.id ? "feeder-button on" : "feeder-button"}
                onClick={() => setFeederId(item.id)}
                aria-pressed={item.id === feeder.id}
              >
                <span>{item.name}<small>{item.quality.completeBuckets} of {item.quality.expectedBuckets} readings</small></span>
                <span className={`quality ${item.quality.status}`}>{Math.round(item.quality.completeness * 100)}%</span>
              </button>
            ))}
          </nav>

          <article className="feeder-detail">
            <div className="feeder-head">
              <div>
                <p className="eyebrow">{substation.name}</p>
                <h3>{feeder.name}</h3>
              </div>
              <span className={`quality-pill ${feeder.quality.status}`}>{qualityLabel(feeder)} · {formatPct(feeder.quality.completeness)}</span>
            </div>

            <div className="now-card">
              <div>
                <p className="now-label">At {cursorTime ? formatTime(cursorTime) : "–"}</p>
                <p className="now-price" style={{ color: stateColor }}>{sample ? formatCurrencyPrice(sample.local) : "–"}<small>/MWh</small></p>
                <p className="state" style={{ color: stateColor }}>{state}</p>
              </div>
              {sample ? (
                <dl className="detail-metrics">
                  <Metric label="Wholesale" value={formatCurrencyPrice(sample.wholesale)} unit="/MWh" />
                  <Metric label="Local add-on" value={formatCurrencyPrice(sample.addon, true)} unit="/MWh" />
                  <Metric label="Signed power" value={formatKw(sample.pKw)} />
                  <Metric label="Flat target" value={formatKw(sample.targetKw)} />
                  <Metric label="Modelled loading" value={formatPct(sample.loading)} />
                  <Metric label="Assumed rating" value={`${Math.round(feeder.ratingKva)} kVA`} />
                </dl>
              ) : (
                <p className="missing-reading">All three power phases were not available for this half-hour, so no value has been estimated.</p>
              )}
            </div>

            <div className="power-chart">
              <div className="chart-title-row">
                <h4>Signed feeder power</h4>
                <div className="chart-key"><span><i className="key-line power" />Observed</span><span><i className="key-line target" />Signed target</span></div>
              </div>
              <SeriesChart
                cursor={index}
                ariaLabel={`Signed feeder power and flat target for ${substation.name} ${feeder.name}`}
                series={[
                  { values: selectedClockSamples.map((item) => item?.pKw ?? null), color: stateColor, width: 2.5 },
                  { values: selectedClockSamples.map((item) => item?.targetKw ?? null), color: "#8e8e8e", width: 2, dash: "7 6" },
                ]}
              />
            </div>
          </article>
        </div>
      </section>

      <section className="section disclosures" aria-label="Method and assumptions">
        <details>
          <summary>How to read this</summary>
          <p>
            Positive local add-ons encourage discharge when demand is above the feeder’s signed daily
            target. Negative add-ons encourage charge when demand is below it or power is exporting.
            “Balanced” means the add-on is within 5% of the model cap. The map draws a line from each
            substation along nearby streets, coloured by that feeder’s local price divided by wholesale.
            Those paths are not SSEN cable routes. Grey means no reading for that half-hour.
          </p>
        </details>
        <details>
          <summary>Model assumptions</summary>
          <p>
            Every feeder uses the same explicit {snapshot.ratingAssumptionAmps} A, 400 V three-phase
            rating assumption ({Math.round(feeder.ratingKva)} kVA). The add-on reaches ±£{formatPrice(cap)}/MWh
            when signed power is half a rating away from its signed mean. The cap is derived from £{snapshot.parameters.gbpPerKva}/kVA,
            a {snapshot.parameters.lifeYears}-year life, {(snapshot.parameters.discountRate * 100).toFixed(0)}% discount rate,
            and {snapshot.parameters.bindingHoursPerYear} binding hours per year.
          </p>
        </details>
        <details>
          <summary>Data quality and method</summary>
          <p>
            NeRDA readings are averaged into 30-minute buckets for each phase, then all three phases are
            summed. A bucket is omitted if any phase is missing; gaps are not interpolated. The pilot
            includes feeders with at least 50% complete buckets. Cohort average coverage is {formatPct(averageCoverage)}.
          </p>
          <p>Current measurements are not used because the returned series could not yet be validated consistently as amperage magnitude.</p>
        </details>
        <details>
          <summary>View selected feeder data</summary>
          <div className="table-wrap">
            <table>
              <caption>{substation.name} {feeder.name}, complete half-hour readings</caption>
              <thead><tr><th>Time</th><th>Power</th><th>Target</th><th>Add-on</th><th>Wholesale</th><th>Local</th></tr></thead>
              <tbody>
                {feeder.samples.map((item) => (
                  <tr key={item.t}>
                    <td>{formatStamp(item.t)}</td><td>{formatKw(item.pKw)}</td><td>{formatKw(item.targetKw)}</td>
                    <td>{formatCurrencyPrice(item.addon, true)}</td><td>{formatCurrencyPrice(item.wholesale)}</td><td>{formatCurrencyPrice(item.local)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <footer className="footer section">
        <p>Contains BMRS data © Elexon Limited. Feeder state derived locally from SSEN NeRDA. Street lines © OpenStreetMap contributors.</p>
        <p>This is an experimental model, not an SSEN tariff, operational instruction, or forecast.</p>
      </footer>
    </main>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return <div><dt>{label}</dt><dd>{value}{unit ? <small>{unit}</small> : null}</dd></div>;
}
