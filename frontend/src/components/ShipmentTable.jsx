import StatusBadge from "./StatusBadge";

/**
 * Shipment table (click a row, or focus it and press Enter / Space, to select it — same handler either way).
 * Wide on purpose: on narrow screens the table scrolls horizontally inside its own container rather than
 * dropping a column. The Vehicle column shows only fields the vehicle record actually has; a shipment
 * with no linked vehicle says so explicitly.
 */
export default function ShipmentTable({ shipments, vehicles, onSelectShipment, selectedId }) {
  const safeShipments = Array.isArray(shipments) ? shipments : [];
  const safeVehicles = Array.isArray(vehicles) ? vehicles : [];

  if (!safeShipments.length) {
    return <p className="text-sm text-slate-600 py-6 text-center">No shipments to display.</p>;
  }

  const vehicleById = Object.fromEntries(safeVehicles.map((v) => [v.id, v]));

  return (
    <div className="overflow-x-auto -mx-4 px-4" tabIndex={0} role="region" aria-label="Shipments table, scrollable">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-2xs font-bold uppercase tracking-wider text-slate-600 border-b border-slate-300 bg-slate-50">
            <th scope="col" className="py-2 px-3">ID</th>
            <th scope="col" className="py-2 px-3">Cargo</th>
            <th scope="col" className="py-2 px-3">Priority</th>
            <th scope="col" className="py-2 px-3">Origin → Destination</th>
            <th scope="col" className="py-2 px-3">Vehicle</th>
            <th scope="col" className="py-2 px-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {safeShipments.map((s) => {
            const vehicle = vehicleById[s.vehicleId];
            const isSelected = selectedId === s.id;
            const select = () => onSelectShipment && onSelectShipment(s);
            return (
              <tr
                key={s.id}
                onClick={select}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select();
                  }
                }}
                tabIndex={0}
                aria-selected={isSelected}
                className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${
                  isSelected ? "bg-primary-50 border-l-4 border-l-primary-500" : ""
                }`}
              >
                <td className="py-2.5 px-3 font-mono text-xs text-slate-700 whitespace-nowrap">{s.id}</td>
                <td className="py-2.5 px-3 font-medium text-slate-900">{s.cargo}</td>
                <td className="py-2.5 px-3">
                  <StatusBadge status={s.priority} />
                </td>
                <td className="py-2.5 px-3 whitespace-nowrap text-slate-800">
                  {s.origin} <span aria-hidden="true">→</span>
                  <span className="sr-only">to</span> {s.destination}
                </td>
                <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                  {vehicle ? (
                    <span className="text-slate-700">
                      <span className="font-mono font-medium">{vehicle.id}</span>
                      <span className="text-slate-500"> · {vehicle.speed ?? "-"} km/h</span>
                      {vehicle.status && <span className="text-slate-500"> · {vehicle.status}</span>}
                    </span>
                  ) : (
                    <span className="text-slate-500 italic">No vehicle linked</span>
                  )}
                </td>
                <td className="py-2.5 px-3">
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
