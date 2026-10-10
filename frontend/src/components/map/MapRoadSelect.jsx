/**
 * MapRoadSelect
 * The keyboard (and screen-reader) way to choose a road from the map panel. Road lines are SVG paths
 * that cannot take keyboard focus, and making hundreds of segments tabbable would bury every other
 * control, so selection is offered as ONE native <select>: a single tab stop, type-ahead to jump to a
 * road, arrow keys to change it.
 *
 * It is a controlled view of the dashboard's existing `selectedRoadId` state (the same state a map
 * click and the Road Intelligence selector set); choosing a road here highlights it on the map and fills
 * Road Intelligence exactly as a click would. It does not pan or zoom the map.
 */

/** Distinguishes roads that share a name (the imported NH 27 has 183 segments) using real fields only. */
export function roadOptionLabel(road) {
  const parts = [road?.name || "Unnamed road"];
  if (road?.district) parts.push(road.district);
  if (road?.sourceId) parts.push(`#${road.sourceId}`);
  return parts.join(" · ");
}

export default function MapRoadSelect({ roads, selectedRoadId, onSelect }) {
  const safeRoads = Array.isArray(roads) ? roads : [];
  if (!safeRoads.length) return null;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <label htmlFor="map-road-select" className="text-xs font-semibold text-slate-700 shrink-0">
        Road
      </label>
      <select
        id="map-road-select"
        value={selectedRoadId || ""}
        onChange={(e) => onSelect(e.target.value)}
        className="min-w-0 max-w-[15rem] text-xs border border-slate-500 rounded-md px-1.5 py-1 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        {!selectedRoadId && (
          <option value="" disabled>
            Select a road…
          </option>
        )}
        {safeRoads.map((r) => (
          <option key={r.id} value={r.id}>
            {roadOptionLabel(r)}
          </option>
        ))}
      </select>
    </div>
  );
}
