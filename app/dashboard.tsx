"use client";

import { useEffect, useMemo, useState } from "react";
import { SeriesChart } from "@/components/charts";
import { PriceMap } from "@/components/price-map";
import { addonColor, ratioColor } from "@/lib/color";
import { formatKwhPrice, formatKw, formatPct, formatStamp, formatTime } from "@/lib/format";
import { substationsOf } from "@/lib/group";
import { localToWholesale, type PricedSample } from "@/lib/price";
import { streetLayout } from "@/lib/street-trace";
import type { Feeder, Snapshot } from "@/lib/types";

const HALF_HOUR_MS = 30 * 60 * 1000;
const PLAYBACK_STEP_MS = 3000;

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

function averageAt(
  feeders: Feeder[],
  t: string | undefined,
  field: "local" | "wholesale",
): number | null {
  const values = feeders.flatMap((feeder) => {
    const sample = sampleAt(feeder, t);
    return sample ? [sample[field]] : [];
  });
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function feederExtremesAt(feeders: Feeder[], t: string | undefined) {
  let premium: { feeder: Feeder; delta: number } | null = null;
  let discount: { feeder: Feeder; delta: number } | null = null;
  for (const feeder of feeders) {
    const sample = sampleAt(feeder, t);
    if (!sample) continue;
    const delta = sample.local - sample.wholesale;
    if (delta > 0 && (!premium || delta > premium.delta)) premium = { feeder, delta };
    if (delta < 0 && (!discount || delta < discount.delta)) discount = { feeder, delta };
  }
  return { premium, discount };
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

function formatRatio(ratio: number): string {
  const digits = Math.abs(ratio) >= 10 ? 1 : 2;
  return `${ratio.toFixed(digits)}×`;
}

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [substationId, setSubstationId] = useState<string | null>(null);
  const [feederId, setFeederId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lon: number; token: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/snapshot")
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as Snapshot;
      })
      .then((data) => {
        if (cancelled) return;
        const clock = clockOf(data);
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const through = clock.findLastIndex((t) => t <= data.window.dataThrough);
        setSnapshot(data);
        setIndex(reducedMotion ? Math.max(0, through) : 0);
        setPlaying(!reducedMotion && clock.length > 1);
        setSubstationId(null);
        setFeederId(null);
      })
      .catch(() => {
        if (!cancelled) setError("The Oxford snapshot could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!playing || !snapshot) return;
    const length = clockOf(snapshot).length;
    if (length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % length);
    }, PLAYBACK_STEP_MS);
    return () => window.clearInterval(timer);
  }, [playing, snapshot]);

  const feeders = useMemo(() => snapshot?.feeders ?? [], [snapshot]);
  const groups = useMemo(() => substationsOf(feeders), [feeders]);
  const layout = useMemo(() => {
    if (snapshot?.streets) return snapshot.streets;
    return streetLayout(
      feeders.map((item) => ({
        id: item.id,
        substationId: item.substationId,
        lat: item.lat,
        lon: item.lon,
      })),
    );
  }, [snapshot, feeders]);
  const clock = useMemo(() => (snapshot ? clockOf(snapshot) : []), [snapshot]);
  const cursorTime = clock[index];
  const substation = groups.find((group) => group.id === substationId);
  const feeder = substation?.feeders.find((item) => item.id === feederId);
  const scopedFeeders = feeder ? [feeder] : substation ? substation.feeders : feeders;
  const sample = feeder ? sampleAt(feeder, cursorTime) : undefined;
  const scopeLocalNow = averageAt(scopedFeeders, cursorTime, "local");
  const scopeWholesaleNow = averageAt(scopedFeeders, cursorTime, "wholesale");
  const instant = {
    localSwingGbpPerMwh:
      scopeLocalNow === null || scopeWholesaleNow === null ? null : scopeLocalNow - scopeWholesaleNow,
    wholesaleGbpPerMwh: scopeWholesaleNow,
    ratio:
      scopeLocalNow === null || scopeWholesaleNow === null || scopeWholesaleNow === 0
        ? null
        : scopeLocalNow / scopeWholesaleNow,
  };
  const scopeLabel = feeder
    ? `${substation?.name ?? "Selected substation"} ${feeder.name}`
    : substation
      ? `${substation.name} downstream LV feeders`
      : "the Oxford distribution network";
  const scopeKind = feeder ? "LV feeder" : substation ? "Substation average" : "Network average";
  const comparisonFeeders = substation ? substation.feeders : feeders;
  const extremes = feederExtremesAt(comparisonFeeders, cursorTime);

  function seek(next: number) {
    setPlaying(false);
    setIndex(next);
  }

  function selectSubstation(id: string, moveMap = false) {
    const group = groups.find((item) => item.id === id);
    setSubstationId(id);
    setFeederId(null);
    if (moveMap && group) setFocus({ lat: group.lat, lon: group.lon, token: Date.now() });
  }

  function clearSelection() {
    setSubstationId(null);
    setFeederId(null);
  }

  function selectFeeder(nextSubstationId: string, nextFeederId: string, moveMap = false) {
    setSubstationId(nextSubstationId);
    setFeederId(nextFeederId);
    if (moveMap) {
      const group = groups.find((item) => item.id === nextSubstationId);
      if (group) setFocus({ lat: group.lat, lon: group.lon, token: Date.now() });
    }
  }

  if (error) {
    return (
      <main className="status">
        <p className="brand">Streetprice</p>
        <h1>We could not load the Oxford map.</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!snapshot || clock.length === 0) {
    return (
      <main className="status">
        <p className="brand">Streetprice</p>
        <h1>Loading the Oxford map…</h1>
      </main>
    );
  }

  const cap = snapshot.capGbpPerMwh;
  const state = stateOf(sample, cap);
  const stateColor = sample ? addonColor(sample.addon, cap) : "#9aa3ab";
  const averageCoverage =
    feeders.reduce((sum, item) => sum + item.quality.completeness, 0) / Math.max(1, feeders.length);
  const selectedClockSamples = feeder
    ? clock.map((t) => sampleAt(feeder, t))
    : clock.map(() => undefined);
  const localSeries = clock.map((t) => averageAt(scopedFeeders, t, "local"));
  const wholesaleSeries = clock.map((t) => averageAt(scopedFeeders, t, "wholesale"));
  const points = groups.map((group) => {
    const ratios = group.feeders.flatMap((item) => {
      const reading = sampleAt(item, cursorTime);
      const ratio = reading ? localToWholesale(reading.local, reading.wholesale) : null;
      return ratio === null ? [] : [ratio];
    });
    const strongestRatio = ratios.reduce<number | null>((strongest, ratio) => {
      if (strongest === null) return ratio;
      return Math.abs(ratio - 1) > Math.abs(strongest - 1) ? ratio : strongest;
    }, null);
    return {
      id: group.id,
      name: group.name,
      lat: group.lat,
      lon: group.lon,
      color: strongestRatio === null ? "#8d969e" : ratioColor(strongestRatio),
      selected: group.id === substation?.id,
    };
  });
  const lines = layout.traces.map((trace) => {
    const item = feeders.find((feederItem) => feederItem.id === trace.feederId);
    const reading = item ? sampleAt(item, cursorTime) : undefined;
    const ratio = reading ? localToWholesale(reading.local, reading.wholesale) : null;
    return {
      feederId: trace.feederId,
      substationId: trace.substationId,
      coordinates: trace.coordinates,
      color: ratio === null ? "#c5c8cc" : ratioColor(ratio),
      selected: trace.feederId === feeder?.id,
    };
  });

  return (
    <main className="story">
      <section className="intro section" id="top">
        <div className="intro-kicker">
          <p className="eyebrow">Local grid signal · 24-hour view</p>
          <a
            className="social-link"
            href="https://x.com/dootonline"
            target="_blank"
            rel="noreferrer"
            aria-label="Doot Online on X"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </div>
        <div className="intro-title-row">
          <h1>Oxford, priced street by street</h1>
          <p className="as-of">Updated {formatStamp(snapshot.window.dataThrough)}</p>
        </div>
        <p className="intro-summary" id="pilot-result">
          Across {groups.length} substations and {feeders.length} LV feeders, local grid conditions moved
          modelled prices {snapshot.comparison.ratio === null ? "–" : <strong>{snapshot.comparison.ratio.toFixed(1)}×</strong>} as much as wholesale.
        </p>
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
              onSelectSubstation={(id) => selectSubstation(id)}
              onSelectFeeder={selectFeeder}
              onClearSelection={clearSelection}
              focus={focus}
            />
            <div className="map-legend" aria-label="Local price divided by wholesale">
              <span>0.5×</span>
              <i className="ratio-scale" />
              <span>2×</span>
              <span className="scale-caption">Local ÷ wholesale</span>
            </div>
          </div>
        </div>

        <section className="comparison-panel" aria-labelledby="comparison-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{scopeKind}</p>
              <h2 id="comparison-title">Local vs wholesale price</h2>
              <p className="scope-label">{scopeLabel}</p>
            </div>
            <div className="chart-key" aria-label="Chart legend">
              <span><i className="key-line local" />{feeder ? "Modelled local" : "Average local"}</span>
              <span><i className="key-line wholesale" />Wholesale</span>
            </div>
          </div>
          <div className="chart-card">
            <SeriesChart
              cursor={index}
              ariaLabel={`${feeder ? "Modelled" : "Average"} local and wholesale price for ${scopeLabel} over 24 hours`}
              yAxis={{ label: "Price (£/kWh)", format: "price" }}
              series={[
                { values: localSeries.map((value) => (value === null ? null : value / 1000)), color: "#171a20", width: 2.5 },
                { values: wholesaleSeries.map((value) => (value === null ? null : value / 1000)), color: "#8e8e8e", width: 2, dash: "7 6" },
              ]}
            />
            <div className="chart-axis" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
          </div>
        </section>

        <dl className="hero-metrics">
          <Metric
            label="Average local price delta"
            value={instant.localSwingGbpPerMwh === null ? "–" : formatKwhPrice(instant.localSwingGbpPerMwh)}
            unit={instant.localSwingGbpPerMwh === null ? undefined : "/kWh"}
          />
          <Metric
            label="Wholesale price"
            value={instant.wholesaleGbpPerMwh === null ? "–" : formatKwhPrice(instant.wholesaleGbpPerMwh)}
            unit={instant.wholesaleGbpPerMwh === null ? undefined : "/kWh"}
          />
          <Metric label="Average local ÷ wholesale" value={instant.ratio === null ? "–" : formatRatio(instant.ratio)} />
          <Metric
            label="Max premium feeder"
            value={extremes.premium ? formatKwhPrice(extremes.premium.delta, true) : "–"}
            unit={extremes.premium ? "/kWh" : undefined}
            detail={extremes.premium?.feeder.substationName ?? "No positive delta"}
            onDetailClick={
              extremes.premium
                ? () => selectFeeder(extremes.premium!.feeder.substationId, extremes.premium!.feeder.id, true)
                : undefined
            }
            tone="premium"
          />
          <Metric
            label="Max discount feeder"
            value={extremes.discount ? formatKwhPrice(extremes.discount.delta, true) : "–"}
            unit={extremes.discount ? "/kWh" : undefined}
            detail={extremes.discount?.feeder.substationName ?? "No negative delta"}
            onDetailClick={
              extremes.discount
                ? () => selectFeeder(extremes.discount!.feeder.substationId, extremes.discount!.feeder.id, true)
                : undefined
            }
            tone="discount"
          />
        </dl>

        <div className="map-follow">
          <TimeScrubber
            index={index}
            clockLength={clock.length}
            cursorTime={cursorTime}
            playing={playing}
            onChange={seek}
            onTogglePlay={() => setPlaying((value) => !value)}
          />
          <SubstationChooser
            groups={groups}
            selectedId={substation?.id ?? null}
            onSelect={(id) => selectSubstation(id, true)}
            onClear={clearSelection}
          />
        </div>
      </section>

      {substation ? <section className="section feeder-section" aria-labelledby="feeder-title">
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
                className={item.id === feeder?.id ? "feeder-button on" : "feeder-button"}
                onClick={() => setFeederId(item.id)}
                aria-pressed={item.id === feeder?.id}
              >
                <span>{item.name}<small>{item.quality.completeBuckets} of {item.quality.expectedBuckets} readings</small></span>
                <span className={`quality ${item.quality.status}`}>{Math.round(item.quality.completeness * 100)}%</span>
              </button>
            ))}
          </nav>

          {feeder ? <article className="feeder-detail">
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
                <p className="now-price" style={{ color: stateColor }}>{sample ? formatKwhPrice(sample.local) : "–"}<small>/kWh</small></p>
                <p className="state" style={{ color: stateColor }}>{state}</p>
              </div>
              {sample ? (
                <dl className="detail-metrics">
                  <Metric label="Wholesale" value={formatKwhPrice(sample.wholesale)} unit="/kWh" />
                  <Metric label="Local add-on" value={formatKwhPrice(sample.addon, true)} unit="/kWh" />
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
          </article> : (
            <article className="feeder-detail selection-empty">
              <p>Select an LV feeder to see its half-hourly power, loading, and local price detail.</p>
            </article>
          )}
        </div>
      </section> : null}

      <section className="section disclosures" aria-label="Method and assumptions">
        <details>
          <summary>How to read this</summary>
          <p>
            Positive local add-ons encourage discharge when demand is above the feeder’s signed daily
            target. Negative add-ons encourage charge when demand is below it or power is exporting.
            “Balanced” means the add-on is within 5% of the model cap. The map draws a line from each
            substation along nearby streets, coloured by that feeder’s local price divided by wholesale.
            Those paths are not SSEN cable routes. Grey means no reading for that half-hour.
            Max premium and discount identify the feeders furthest above and below wholesale at the selected
            half-hour, across either the whole network or the selected substation.
          </p>
        </details>
        <details>
          <summary>Model assumptions</summary>
          <p>
            Where no published limit is available, a feeder uses an explicit {snapshot.ratingAssumptionAmps} A,
            400 V three-phase rating assumption. The add-on reaches ±{formatKwhPrice(cap)}/kWh
            when signed power is half a rating away from its signed mean. The cap is derived from £{snapshot.parameters.gbpPerKva}/kVA,
            a {snapshot.parameters.lifeYears}-year life, {(snapshot.parameters.discountRate * 100).toFixed(0)}% discount rate,
            and {snapshot.parameters.bindingHoursPerYear} binding hours per year.
          </p>
        </details>
        <details>
          <summary>Data quality and method</summary>
          <p>
            NeRDA readings are averaged into 30-minute buckets for each phase, then all three phases are
            summed. A bucket is omitted if any phase is missing; gaps are not interpolated. This map
            includes the {snapshot.comparison.feederCount} feeders in the Oxford box with at least 50% complete
            buckets. Feeders without a reading at the selected time are grey. Average coverage across the
            mapped feeders is {formatPct(averageCoverage)}.
          </p>
          <p>Current measurements are not used because the returned series could not yet be validated consistently as amperage magnitude.</p>
        </details>
        {feeder && substation ? <details>
          <summary>View selected feeder data</summary>
          <div className="table-wrap">
            <table>
              <caption>{substation.name} {feeder.name}, complete half-hour readings</caption>
              <thead><tr><th>Time</th><th>Power</th><th>Target</th><th>Add-on</th><th>Wholesale</th><th>Local</th></tr></thead>
              <tbody>
                {feeder.samples.map((item) => (
                  <tr key={item.t}>
                    <td>{formatStamp(item.t)}</td><td>{formatKw(item.pKw)}</td><td>{formatKw(item.targetKw)}</td>
                    <td>{formatKwhPrice(item.addon, true)}</td><td>{formatKwhPrice(item.wholesale)}</td><td>{formatKwhPrice(item.local)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details> : null}
      </section>

      <footer className="footer section">
        <p>Contains BMRS data © Elexon Limited. Feeder state derived locally from SSEN NeRDA. Street lines © OpenStreetMap contributors.</p>
        <p>This is an experimental model, not an SSEN tariff, operational instruction, or forecast.</p>
      </footer>
    </main>
  );
}

function SubstationChooser({
  groups,
  selectedId,
  onSelect,
  onClear,
}: {
  groups: Array<{ id: string; name: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  if (groups.length <= 8) {
    return (
      <div className="location-switcher" role="group" aria-label="Choose a substation">
        <button
          type="button"
          className={selectedId === null ? "location on" : "location"}
          onClick={onClear}
          aria-pressed={selectedId === null}
        >
          Whole network
        </button>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={group.id === selectedId ? "location on" : "location"}
            onClick={() => onSelect(group.id)}
            aria-pressed={group.id === selectedId}
          >
            {group.name}
          </button>
        ))}
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const matches = groups.filter((group) => group.name.toLowerCase().includes(needle));
  return (
    <div className="substation-search">
      <label>
        <span>{groups.length} substations</span>
        <input
          value={query}
          placeholder="Search"
          aria-label="Search substations"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) onSelect(matches[0].id);
          }}
        />
      </label>
      <div className="substation-results" role="listbox" aria-label="Substations">
        {!needle ? (
          <button
            type="button"
            role="option"
            aria-selected={selectedId === null}
            className={selectedId === null ? "location on" : "location"}
            onClick={() => {
              setQuery("");
              onClear();
            }}
          >
            Whole network
          </button>
        ) : null}
        {matches.map((group) => (
          <button
            key={group.id}
            type="button"
            role="option"
            aria-selected={group.id === selectedId}
            className={group.id === selectedId ? "location on" : "location"}
            onClick={() => {
              setQuery("");
              onSelect(group.id);
            }}
          >
            {group.name}
          </button>
        ))}
      </div>
      {matches.length === 0 ? <p className="substation-empty">No substation matches that name.</p> : null}
    </div>
  );
}

function TimeScrubber({
  index,
  clockLength,
  cursorTime,
  playing,
  onChange,
  onTogglePlay,
}: {
  index: number;
  clockLength: number;
  cursorTime: string | undefined;
  playing: boolean;
  onChange: (index: number) => void;
  onTogglePlay: () => void;
}) {
  return (
    <div className="time-control">
      <div>
        <button type="button" className="play" aria-pressed={playing} onClick={onTogglePlay}>
          {playing ? "Pause" : "Play"}
        </button>
        <span>30 min every 3 s</span>
        <strong>{cursorTime ? formatStamp(cursorTime) : "–"}</strong>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, clockLength - 1)}
        value={index}
        aria-label="Time of day"
        aria-valuetext={cursorTime ? formatStamp(cursorTime) : ""}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  detail,
  onDetailClick,
  tone,
  compact = false,
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  onDetailClick?: () => void;
  tone?: "premium" | "discount";
  compact?: boolean;
}) {
  return (
    <div className={`metric${tone ? ` ${tone}` : ""}${compact ? " compact" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}{unit ? <small>{unit}</small> : null}</dd>
      {detail ? (
        onDetailClick ? (
          <button type="button" className="metric-detail metric-link" onClick={onDetailClick}>{detail}</button>
        ) : (
          <p className="metric-detail">{detail}</p>
        )
      ) : null}
    </div>
  );
}
