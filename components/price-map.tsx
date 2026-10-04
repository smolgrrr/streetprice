"use client";

import { useEffect, useRef } from "react";
import {
  GeoJSONSource,
  LngLatBounds,
  Map,
  type MapLayerMouseEvent,
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
  color: string;
  selected: boolean;
};

const empty = { type: "FeatureCollection" as const, features: [] };

export function PriceMap({
  points,
  onSelect,
}: {
  points: MapPoint[];
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const fitted = useRef(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const element = container.current;
    if (!element || mapRef.current) return;
    const map = new Map({
      container: element,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-1.22, 51.745],
      zoom: 12,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("substations", { type: "geojson", data: empty });
      map.addLayer({
        id: "substations",
        type: "circle",
        source: "substations",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], 1], 11, 8],
          "circle-color": ["get", "color"],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3, 1.5],
          "circle-stroke-color": "#f7fafc",
        },
      });
      map.on("click", "substations", (event: MapLayerMouseEvent) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") onSelectRef.current(id);
      });
      map.on("mouseenter", "substations", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "substations", () => {
        map.getCanvas().style.cursor = "";
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
    if (!map || points.length === 0) return;
    const apply = () => {
      const source = map.getSource("substations");
      if (!source || source.type !== "geojson") return;
      (source as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: points.map((point) => ({
          type: "Feature",
          properties: {
            id: point.id,
            name: point.name,
            color: point.color,
            selected: point.selected ? 1 : 0,
          },
          geometry: { type: "Point", coordinates: [point.lon, point.lat] },
        })),
      });
      if (!fitted.current) {
        const bounds = new LngLatBounds();
        for (const point of points) bounds.extend([point.lon, point.lat]);
        map.fitBounds(bounds, { padding: 72, maxZoom: 13, duration: 0 });
        fitted.current = true;
      }
    };
    if (map.isStyleLoaded() && map.getSource("substations")) apply();
    else map.once("load", apply);
  }, [points]);

  return <div ref={container} className="map" />;
}
