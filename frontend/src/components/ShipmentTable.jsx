import StatusBadge from "./StatusBadge";

/** Sortable-by-click-ready shipment table (click a row to select it). */
export default function ShipmentTable({ shipments, vehicles, onSelectShipment, selectedId }) {
  const safeShipments = Array.isArray(shipments) ? shipments : [];
  const safeVehicles = Array.isArray(vehicles) ? vehicles : [];

  if (!safeShipments.length) {
    return <p className="text-sm text-slate-500 py-6 text-center">No shipments to display.</p>;
  }

  const vehicleById = Object.fromEntries(safeVehicles.map((v) => [v.id, v]));

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-4">ID</th>
            <th className="py-2 pr-4">Cargo</th>
            <th className="py-2 pr-4">Priority</th>
            <th className="py-2 pr-4">Origin → Destination</th>
            <th className="py-2 pr-4">Vehicle</th>
            <th className="py-2 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {safeShipments.map((s) => {
            const vehicle = vehicleById[s.vehicleId];
            const isSelected = selectedId === s.id;
            return (
              <tr
                key={s.id}
                onClick={() => onSelectShipment && onSelectShipment(s)}
                className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition ${
                  isSelected ? "bg-brand-50" : ""
                }`}
              >
                <td className="py-2 pr-4 font-mono text-xs text-slate-600">{s.id}</td>
                <td className="py-2 pr-4">{s.cargo}</td>
                <td className="py-2 pr-4">
                  <StatusBadge status={s.priority} />
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {s.origin} → {s.destination}
                </td>
                <td className="py-2 pr-4 text-xs text-slate-500">
                  {vehicle ? `${vehicle.id} (${vehicle.speed ?? "-"} km/h)` : "—"}
                </td>
                <td className="py-2 pr-4">
                  <StatusBadge status={s.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
