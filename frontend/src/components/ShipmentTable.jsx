import StatusBadge from "./StatusBadge";

/**
 * Shipment table (click a row, or focus its ID button and press Enter / Space, to select it — same handler either way).
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
        <caption className="sr-only">Shipments. Use the shipment ID button in each row to select it.</caption>
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
                className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition focus-within:bg-slate-50 ${
                  isSelected ? "bg-primary-50 border-l-4 border-l-primary-500" : ""
                }`}
              >
                <td className="py-2.5 px-3 font-mono text-xs text-slate-700 whitespace-nowrap">
                  {/* Native button = the keyboard/AT control (Enter and Space click it; the click bubbles to the row). */}
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    className="rounded px-1 -mx-1 font-mono text-xs text-primary-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    {s.id}
                    {isSelected && <span className="sr-only"> (selected)</span>}
                  </button>
                </td>
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
                      <span className="text-slate-600"> · {vehicle.speed ?? "-"} km/h</span>
                      {vehicle.status && <span className="text-slate-600"> · {vehicle.status}</span>}
                    </span>
                  ) : (
                    <span className="text-slate-600 italic">No vehicle linked</span>
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
