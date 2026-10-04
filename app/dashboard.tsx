"use client";

import { useEffect, useMemo, useState } from "react";
import { bestCycle } from "@/lib/battery";
import { addonColor } from "@/lib/color";
import { formatKw, formatPct, formatPounds, formatPrice, formatSigned, formatStamp } from "@/lib/format";
import { sampleNearest, substationsOf } from "@/lib/group";
import type { Feeder, Snapshot } from "@/lib/types";
import { SeriesChart } from "@/components/charts";
import { PriceMap } from "@/components/price-map";

function clockOf(feeders: Feeder[]): string[] {
  const times = new Set<string>();
  for (const feeder of feeders) {
    for (const sample of feeder.samples) times.add(sample.t);
  }
  return [...times].sort();
}

function mostUrgent(feeders: Feeder[], t: string | undefined): Feeder | undefined {
  if (!t) return feeders[0];
  return feeders.reduce<Feeder | undefined>((best, feeder) => {
    const addon = Math.abs(sampleNearest(feeder, t)?.addon ?? 0);
    const bestAddon = best ? Math.abs(sampleNearest(best, t)?.addon ?? 0) : -1;
    return addon > bestAddon ? feeder : best;
  }, undefined);
}

function ratingLabel(feeder: Feeder): string {
  const kva = Math.round(feeder.ratingKva);
  if (feeder.ratingSource === "assumed-transformer-share") {
    return `${kva} kVA, shared from the transformer`;
  }
  if (feeder.ratingSource === "amps") {
    return `${kva} kVA, from the feeder current limit`;
  }
  return `${kva} kVA`;
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
        const clock = clockOf(data.feeders);
        const t = clock[clock.length - 1];
        const chosen = mostUrgent(data.feeders, t);
        setSnapshot(data);
        setIndex(Math.max(0, clock.length - 1));
        setSubstationId(chosen?.substationId ?? null);
        setFeederId(chosen?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("The price snapshot could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const feeders = useMemo(() => snapshot?.feeders ?? [], [snapshot]);
  const clock = useMemo(() => clockOf(feeders), [feeders]);
  const cursorTime = clock[index] ?? clock.at(-1);
  const groups = useMemo(() => substationsOf(feeders), [feeders]);
  const substation = groups.find((group) => group.id === substationId) ?? groups[0];
  const feeder =
    substation?.feeders.find((item) => item.id === feederId) ??
    (substation && cursorTime ? mostUrgent(substation.feeders, cursorTime) : undefined);
  const sample = feeder && cursorTime ? sampleNearest(feeder, cursorTime) : undefined;

  const cycles = feeder
    ? {
        wholesale: bestCycle(
          feeder.samples.map((item) => ({ t: item.t, gbpPerMwh: item.wholesale })),
        ),
        local: bestCycle(feeder.samples.map((item) => ({ t: item.t, gbpPerMwh: item.local }))),
      }
    : null;

  const points = groups.map((group) => {
    const urgent = cursorTime ? mostUrgent(group.feeders, cursorTime) : group.feeders[0];
    const urgentSample = urgent && cursorTime ? sampleNearest(urgent, cursorTime) : undefined;
    return {
      id: group.id,
      name: group.name,
      lat: group.lat,
      lon: group.lon,
      color: addonColor(urgentSample?.addon ?? 0, snapshot?.capGbpPerMwh ?? 1),
      selected: group.id === substation?.id,
    };
  });

  function selectSubstation(id: string) {
    setSubstationId(id);
    const group = groups.find((item) => item.id === id);
    const urgent = group && cursorTime ? mostUrgent(group.feeders, cursorTime) : group?.feeders[0];
    setFeederId(urgent?.id ?? null);
  }

  if (error) {
    return (
      <main className="status">
        <h1>Streetprice</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!snapshot || !feeder || !sample || !substation) {
    return (
      <main className="status">
        <h1>Streetprice</h1>
        <p>Loading feeder prices.</p>
      </main>
    );
  }

  const cap = snapshot.capGbpPerMwh;
  const priceColor = addonColor(sample.addon, cap);
  const chartSamples = clock.map((t) => sampleNearest(feeder, t) ?? sample);

  return (
    <main className="shell">
      <div className="map-wrap">
        <PriceMap points={points} onSelect={selectSubstation} />
        <header className="mast">
          <div>
            <h1>Streetprice</h1>
            <p>Oxford low-voltage feeders</p>
          </div>
          <p className="mast-time">{cursorTime ? formatStamp(cursorTime) : ""}</p>
        </header>
        <div className="legend">
          <span className="swatch" style={{ background: "#0f6e6a" }} />
          <span>Charge</span>
          <span className="swatch" style={{ background: "#17202a" }} />
          <span>Flat</span>
          <span className="swatch" style={{ background: "#d2451e" }} />
          <span>Discharge</span>
        </div>
      </div>

      <aside className="panel">
        {snapshot.source === "fixture" ? (
          <p className="banner">
            Worked example for two Oxford substations. Live feeder readings replace it once NeRDA is
            connected.
          </p>
        ) : null}

        <div className="switcher" role="group" aria-label="Substations">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={group.id === substation.id ? "switch on" : "switch"}
              onClick={() => selectSubstation(group.id)}
            >
              {group.name}
            </button>
          ))}
        </div>

        <p className="eyebrow">{substation.name}</p>
        <h2>{feeder.name}</h2>
        <p className="price" style={{ color: priceColor }}>
          {formatPrice(sample.local)}
          <span> £/MWh</span>
        </p>

        <dl className="stats">
          <div>
            <dt>Wholesale</dt>
            <dd>{formatPrice(sample.wholesale)}</dd>
          </div>
          <div>
            <dt>Add-on</dt>
            <dd style={{ color: priceColor }}>{formatSigned(sample.addon)}</dd>
          </div>
          <div>
            <dt>Loading</dt>
            <dd>{formatPct(sample.loading)}</dd>
          </div>
          <div>
            <dt>Flat target</dt>
            <dd>{formatKw(sample.targetKw)}</dd>
          </div>
          <div>
            <dt>Power now</dt>
            <dd>{formatKw(sample.pKw)}</dd>
          </div>
          <div>
            <dt>Rating</dt>
            <dd>{ratingLabel(feeder)}</dd>
          </div>
        </dl>

        <figure>
          <figcaption>
            <span>Local price</span>
            <span>Wholesale</span>
          </figcaption>
          <SeriesChart
            cursor={index}
            series={[
              { values: chartSamples.map((item) => item.local), color: "#17202a", width: 1.75 },
              {
                values: chartSamples.map((item) => item.wholesale),
                color: "#5c6b7a",
                width: 1.25,
                dash: "4 3",
              },
            ]}
          />
        </figure>

        <figure>
          <figcaption>
            <span>Feeder power</span>
            <span>Flat target</span>
          </figcaption>
          <SeriesChart
            cursor={index}
            series={[
              { values: chartSamples.map((item) => item.pKw), color: priceColor, width: 1.75 },
              {
                values: chartSamples.map((item) => item.targetKw),
                color: "#5c6b7a",
                width: 1.25,
                dash: "4 3",
              },
            ]}
          />
        </figure>

        <section className="cycles">
          <h3>One 10 kWh cycle, last 24 hours</h3>
          <p className="hint">Hindsight. Charge comes before discharge. 90% round trip.</p>
          <CycleRow label="Wholesale" cycle={cycles?.wholesale ?? null} />
          <CycleRow label="This feeder" cycle={cycles?.local ?? null} />
        </section>

        <section>
          <h3>Feeders on this transformer</h3>
          <p className="hint">The map dot takes the colour of the feeder with the strongest add-on.</p>
          <ul className="feeders">
            {substation.feeders.map((item) => {
              const at = cursorTime ? sampleNearest(item, cursorTime) : undefined;
              const color = addonColor(at?.addon ?? 0, cap);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.id === feeder.id ? "feeder on" : "feeder"}
                    style={{ borderLeftColor: color }}
                    onClick={() => setFeederId(item.id)}
                  >
                    <span>{item.name}</span>
                    <span className="feeder-price" style={{ color }}>
                      {at ? formatPrice(at.local) : "–"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <details className="method">
          <summary>How this price is made</summary>
          <p>
            Local price is the Elexon Market Index Price plus an add-on. The add-on is zero when the
            feeder carries its flat target, the average absolute power over the day on screen. It
            reaches {formatPrice(cap)} £/MWh when power is half a rating away from that target. The
            cap comes from £{snapshot.parameters.gbpPerKva}/kVA over {snapshot.parameters.lifeYears}{" "}
            years at {(snapshot.parameters.discountRate * 100).toFixed(0)}%, spread across{" "}
            {snapshot.parameters.bindingHoursPerYear} binding hours a year.
          </p>
          <p>
            Everyone on the feeder sees the same price. A positive add-on pays a battery to discharge.
            A negative add-on pays it to charge, including when the feeder is pushing solar back
            through the transformer.
          </p>
        </details>

        <p className="credits">
          Contains BMRS data © Elexon Limited. Feeder state derived from SSEN NeRDA. This price is a
          model, and it is not an SSEN tariff.
        </p>
      </aside>

      <footer className="ruler">
        <div className="ruler-labels">
          <span>{clock[0] ? formatStamp(clock[0]) : ""}</span>
          <span>{index === clock.length - 1 ? "Latest" : cursorTime ? formatStamp(cursorTime) : ""}</span>
          <span>Latest</span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, clock.length - 1)}
          value={Math.min(index, Math.max(0, clock.length - 1))}
          aria-label="Time"
          aria-valuetext={cursorTime ? formatStamp(cursorTime) : ""}
          onChange={(event) => setIndex(Number(event.target.value))}
        />
      </footer>
    </main>
  );
}

function CycleRow({
  label,
  cycle,
}: {
  label: string;
  cycle: { buyAt: string; sellAt: string; profitGbp: number } | null;
}) {
  return (
    <p className="cycle">
      <span>{label}</span>
      <span className="cycle-profit">{cycle ? formatPounds(cycle.profitGbp) : "–"}</span>
      <span className="cycle-when">
        {cycle ? `${formatStamp(cycle.buyAt)} to ${formatStamp(cycle.sellAt)}` : ""}
      </span>
    </p>
  );
}
