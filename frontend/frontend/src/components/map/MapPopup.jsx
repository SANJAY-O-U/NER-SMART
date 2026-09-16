import React from "react";

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
  let color = "bg-emerald-100 text-emerald-700";
  let label = "LOW";
  if (risk > 60) {
    color = "bg-red-100 text-red-700";
    label = "HIGH";
  } else if (risk > 30) {
    color = "bg-amber-100 text-amber-700";
    label = "MEDIUM";
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${color}`}>
      {label} ({risk})
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    OPEN: "bg-emerald-100 text-emerald-700",
    RISKY: "bg-amber-100 text-amber-700",
    BLOCKED: "bg-red-100 text-red-700",
  };
  const cls = map[status] || "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {status || "UNKNOWN"}
    </span>
  );
}

export default function MapPopup({ type, data }) {
  if (!data) return null;

  if (type === "road") {
    return (
      <div className="min-w-[190px]">
        <div className="font-semibold text-slate-900 mb-1">{data.name || "Unnamed Road"}</div>
        <Row label="Road ID" value={data.id} />
        <div className="flex justify-between items-center py-0.5">
          <span className="text-slate-500 text-sm">Status</span>
          <StatusBadge status={data.physicalStatus && data.physicalStatus !== "UNKNOWN" ? data.physicalStatus : data.status} />
        </div>
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
              <p className="text-[11px] text-slate-400 mt-1 italic">
                Closure status not verified — imported geometry only.
              </p>
            )}
          </>
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
