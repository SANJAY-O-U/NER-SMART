import React, { useState } from "react";
import { roadStatusDisplay } from "../../theme/status";

/**
 * MapLegend
 * Compact, collapsible legend + layer toggles. Presentation only: it holds no
 * data. Each toggle is rendered only for a layer that actually has content,
 * and the parent (MapView) owns the visibility state.
 *
 * Props:
 *   layers: Array<{ key, label, count, visible }>   // layers to offer a toggle for
 *   onToggle: (key) => void
 *   showRoutes: boolean                              // whether a route line is currently drawn
 */

// Same keys the road layer resolves to; labels come from the semantic palette.
const STATUS_ROWS = [
  { key: "OPEN", note: "Accessible" },
  { key: "RESTRICTED", note: "At risk" },
  { key: "HIGH_RISK", note: "Disrupted" },
  { key: "BLOCKED", note: "Blocked" },
  { key: "UNKNOWN", note: "Unknown / unverified" },
];

const WEIGHT = { BLOCKED: 5, HIGH_RISK: 4 };

function Swatch({ statusKey }) {
  const info = roadStatusDisplay(statusKey);
  return (
    <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true" className="shrink-0">
      <line
        x1="1"
        y1="5"
        x2="27"
        y2="5"
        stroke={info.hex}
        strokeWidth={WEIGHT[statusKey] || 3}
        strokeLinecap="round"
        strokeDasharray={statusKey === "UNKNOWN" ? "6 4" : undefined}
      />
    </svg>
  );
}

export default function MapLegend({ layers = [], onToggle, showRoutes = false }) {
  // Open by default on wider screens; collapsed on phones so it never covers the map.
  const [open, setOpen] = useState(() => {
    try {
      return window.matchMedia("(min-width: 768px)").matches;
    } catch {
      return false;
    }
  });

  return (
    <div className="absolute z-[1000] left-2 bottom-6 top-20 max-w-[calc(100%-1rem)] flex flex-col items-start justify-end pointer-events-none text-xs text-slate-700">
      {open && (
        <div
          id="map-legend-panel"
          className="pointer-events-auto mb-1 w-56 min-h-0 overflow-y-auto rounded-lg border border-slate-200 bg-white/95 p-2.5 shadow-md"
        >
          <p className="font-semibold text-slate-800 mb-1">Road status</p>
          <ul className="space-y-1">
            {STATUS_ROWS.map(({ key, note }) => {
              const info = roadStatusDisplay(key);
              return (
                <li key={key} className="flex items-center gap-2">
                  <Swatch statusKey={key} />
                  <span aria-hidden="true" className="w-3 text-center font-bold">
                    {info.glyph}
                  </span>
                  <span>{note}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-2xs text-slate-600">
            Dashed gray = status not verified, never "safe". Thicker line = blocked / disrupted. A blue halo marks the
            road selected in Road Intelligence.
          </p>

          {layers.length > 0 && (
            <>
              <p className="font-semibold text-slate-800 mt-2 mb-1">Layers</p>
              <ul className="space-y-0.5">
                {layers.map((layer) => (
                  <li key={layer.key}>
                    <label className="flex items-center gap-2 py-0.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={layer.visible}
                        onChange={() => onToggle(layer.key)}
                        className="h-4 w-4 rounded border-slate-500 accent-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                      <span className="flex-1">{layer.label}</span>
                      <span className="text-slate-600">{layer.count}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {showRoutes && (
            <p className="mt-1 text-2xs text-slate-600">Dotted violet line = real route geometry for the analysed route.</p>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="map-legend-panel"
        className="pointer-events-auto shrink-0 rounded-md border border-slate-300 bg-white/95 px-2.5 py-1 font-semibold text-slate-700 shadow-sm hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        {open ? "Hide legend" : "Legend & layers"}
      </button>
    </div>
  );
}
