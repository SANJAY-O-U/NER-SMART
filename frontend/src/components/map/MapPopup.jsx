import React from "react";
import { roadStatusDisplay, riskLevelDisplay } from "../../theme/status";

/**
 * MapPopup
 * Renders the content that goes INSIDE a react-leaflet <Popup>.
 * Kept as a plain content renderer (no <Popup> wrapper here) so each
 * layer can decide how/where to mount it.
 *
 * Usage:
 *   <Popup><MapPopup type="road" data={road} /></Popup>
 */

function Row({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex justify-between gap-4 text-sm py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 text-right">{value}</span>
    </div>
  );
}

function RiskBadge({ risk }) {
  if (risk === undefined || risk === null) return null;
  const level = riskLevelDisplay(risk);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold ${level.badge}`}>
      <span aria-hidden="true">{level.glyph}</span>
      {level.label} ({risk})
    </span>
  );
}

function StatusBadge({ status }) {
  const info = roadStatusDisplay(status);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold ${info.badge}`}>
      <span aria-hidden="true">{info.glyph}</span>
      {info.label}
    </span>
  );
}

export default function MapPopup({ type, data, linkToIntelligence = false }) {
  if (!data) return null;

  if (type === "road") {
    const status = data.physicalStatus && data.physicalStatus !== "UNKNOWN" ? data.physicalStatus : data.status;
    return (
      <div className="min-w-[190px] max-w-[260px]">
        <div className="font-semibold text-base leading-tight text-slate-900">{data.name || "Unnamed Road"}</div>
        <div className="mt-1 mb-1.5">
          <StatusBadge status={status} />
        </div>
        <Row label="Road ID" value={data.id} />
        <Row label="Flood risk" value={data.floodRisk} />
        <Row label="Landslide risk" value={data.landslideRisk} />
        <div className="flex justify-between items-center py-0.5">
          <span className="text-slate-500 text-sm">Overall risk</span>
          <RiskBadge risk={data.overallRisk ?? data.risk} />
        </div>
        {data.source && (
          <>
            <Row label="Source" value={data.source.split(' — ')[0].split(' (')[0]} />
            {data.physicalStatus === "UNKNOWN" && (
              <p className="text-2xs text-slate-600 mt-1 italic">
                Closure status not verified — imported geometry only.
              </p>
            )}
          </>
        )}
        {linkToIntelligence && (
          <a
            href="#road-intelligence"
            className="mt-2 inline-block text-xs font-semibold text-primary-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
          >
            View in Road Intelligence ↓
          </a>
        )}
      </div>
    );
  }

  if (type === "vehicle") {
    return (
      <div className="min-w-[170px]">
        <div className="font-semibold text-slate-900 mb-1">Vehicle {data.id}</div>
        <Row label="Shipment" value={data.shipmentId} />
        <Row label="Speed" value={data.speed !== undefined ? `${data.speed} km/h` : undefined} />
        <Row label="Status" value={data.status} />
      </div>
    );
  }

  if (type === "incident") {
    return (
      <div className="min-w-[190px]">
        <div className="font-semibold text-slate-900 mb-1">{data.type || "Incident"}</div>
        <Row label="Severity" value={data.severity} />
        <Row label="Reported" value={data.timestamp ? new Date(data.timestamp).toLocaleString() : undefined} />
        {data.description && (
          <p className="text-sm text-slate-600 mt-1">{data.description}</p>
        )}
      </div>
    );
  }

  if (type === "facility") {
    return (
      <div className="min-w-[170px]">
        <div className="font-semibold text-slate-900 mb-1">{data.name || "Facility"}</div>
        <Row label="Type" value={data.type} />
        <Row label="Capacity" value={data.capacity} />
        <Row label="Status" value={data.status} />
      </div>
    );
  }

  return null;
}
