"use client";

import { useEffect, useRef } from "react";
import {
  GeoJSONSource,
  LngLatBounds,
  Map,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Turbopack's module URL is not the package dist directory, so the worker
// cannot import its sibling from there. predev copies both files into public.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export type MapPoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  selected: boolean;
};

export type MapLine = {
  feederId: string;
  substationId: string;
  coordinates: [number, number][][];
  color: string;
  selected: boolean;
};

export type MapStub = {
  substationId: string;
  coordinates: [[number, number], [number, number]];
};

const empty = { type: "FeatureCollection" as const, features: [] };

export function PriceMap({
  points,
  lines,
  stubs,
  onSelectSubstation,
  onSelectFeeder,
}: {
  points: MapPoint[];
  lines: MapLine[];
  stubs: MapStub[];
  onSelectSubstation: (id: string) => void;
  onSelectFeeder: (substationId: string, feederId: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const onSelectSubstationRef = useRef(onSelectSubstation);
  const onSelectFeederRef = useRef(onSelectFeeder);
  const fitted = useRef(false);

  useEffect(() => {
    onSelectSubstationRef.current = onSelectSubstation;
    onSelectFeederRef.current = onSelectFeeder;
  }, [onSelectSubstation, onSelectFeeder]);

  useEffect(() => {
    const element = container.current;
    if (!element || mapRef.current) return;
    const map = new Map({
      container: element,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [-1.22, 51.745],
      zoom: 12,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => {
      map.addSource("feeders", { type: "geojson", data: empty });
      map.addSource("stubs", { type: "geojson", data: empty });
      map.addSource("substations", { type: "geojson", data: empty });
      map.addLayer({
        id: "feeder-glow",
        type: "line",
        source: "feeders",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["==", ["get", "selected"], 1], 18, 14],
          "line-opacity": 0.38,
          "line-blur": 1.6,
        },
      });
      map.addLayer({
        id: "feeders",
        type: "line",
        source: "feeders",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["==", ["get", "selected"], 1], 7, 5],
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "stubs",
        type: "line",
        source: "stubs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#171a20", "line-width": 2, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "substations",
        type: "circle",
        source: "substations",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], 1], 7, 5],
          "circle-color": "#171a20",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on("click", (event) => {
        const hits = map.queryRenderedFeatures(event.point, { layers: ["substations", "feeders", "feeder-glow"] });
        const dot = hits.find((feature) => feature.layer.id === "substations");
        const line = hits.find((feature) => feature.layer.id === "feeders" || feature.layer.id === "feeder-glow");
        const dotId = dot?.properties?.id;
        if (typeof dotId === "string") {
          onSelectSubstationRef.current(dotId);
          return;
        }
        const substationId = line?.properties?.substationId;
        const feederId = line?.properties?.feederId;
        if (typeof substationId === "string" && typeof feederId === "string") {
          onSelectFeederRef.current(substationId, feederId);
        }
      });
      map.on("mousemove", (event) => {
        const hits = map.queryRenderedFeatures(event.point, { layers: ["substations", "feeders", "feeder-glow"] });
        map.getCanvas().style.cursor = hits.length > 0 ? "pointer" : "";
      });
    });
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || (points.length === 0 && lines.length === 0)) return;
    const apply = () => {
      const feederSource = map.getSource("feeders");
      const stubSource = map.getSource("stubs");
      const substationSource = map.getSource("substations");
      if (
        !feederSource ||
        feederSource.type !== "geojson" ||
        !stubSource ||
        stubSource.type !== "geojson" ||
        !substationSource ||
        substationSource.type !== "geojson"
      ) {
        return;
      }
      (feederSource as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: lines.map((line) => ({
          type: "Feature" as const,
          properties: {
            feederId: line.feederId,
            substationId: line.substationId,
            color: line.color,
            selected: line.selected ? 1 : 0,
          },
          geometry: { type: "MultiLineString" as const, coordinates: line.coordinates },
        })),
      });
      (stubSource as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: stubs.map((stub) => ({
          type: "Feature" as const,
          properties: { substationId: stub.substationId },
          geometry: { type: "LineString" as const, coordinates: stub.coordinates },
        })),
      });
      (substationSource as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: points.map((point) => ({
          type: "Feature" as const,
          properties: { id: point.id, name: point.name, selected: point.selected ? 1 : 0 },
          geometry: { type: "Point" as const, coordinates: [point.lon, point.lat] },
        })),
      });
      if (!fitted.current && (points.length > 0 || lines.length > 0)) {
        const bounds = new LngLatBounds();
        for (const point of points) bounds.extend([point.lon, point.lat]);
        for (const line of lines) {
          for (const path of line.coordinates) {
            for (const coord of path) bounds.extend(coord);
          }
        }
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 0 });
          fitted.current = true;
        }
      }
    };
    if (map.isStyleLoaded() && map.getSource("feeders")) apply();
    else map.once("load", apply);
  }, [points, lines, stubs]);

  return (
    <div
      ref={container}
      className="map"
      role="img"
      aria-label="Map of nearby streets coloured by local price divided by wholesale. Lines run out from each substation. They are not the mapped cables."
    />
  );
}
