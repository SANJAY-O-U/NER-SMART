import { useEffect, useState } from "react";
import {
  GridIcon,
  MapIcon,
  BellIcon,
  PulseIcon,
  AlertTriangleIcon,
  NavigationIcon,
  PackageIcon,
  DatabaseIcon,
} from "./icons";
import { writesEnabled } from "../services/api";

/**
 * In-page section navigation. The app is a single page with no router, so these items scroll to the
 * existing dashboard sections; they never change the URL or any application state. Only sections
 * that actually exist on the page are listed.
 */
export const NAV_SECTIONS = [
  { id: "overview", label: "Overview", Icon: GridIcon },
  { id: "map", label: "Live Map", Icon: MapIcon },
  { id: "alerts", label: "Alerts", Icon: BellIcon },
  { id: "road-intelligence", label: "Road Intelligence", Icon: PulseIcon },
  { id: "incidents", label: "Incidents", Icon: AlertTriangleIcon },
  { id: "routes", label: "Routes", Icon: NavigationIcon },
  { id: "shipments", label: "Shipments", Icon: PackageIcon },
  { id: "data-sources", label: "Data Sources", Icon: DatabaseIcon },
];

export function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  let reduceMotion = false;
  try {
    reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // matchMedia unavailable: fall back to smooth scrolling.
  }
  el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  // Move keyboard focus to the section so the next Tab continues from where the user navigated to
  // (sections carry tabIndex={-1}); preventScroll keeps the scroll above as the only movement.
  if (el.hasAttribute("tabindex")) el.focus({ preventScroll: true });
}

/** Tracks which section is currently under the sticky header (scroll-spy). Purely visual. */
export function useActiveSection(enabled = true) {
  const [active, setActive] = useState(NAV_SECTIONS[0].id);

  // `enabled` is false while the loading / error screen is showing (no sections exist yet); the
  // effect re-runs when the sections appear so the observer attaches to real elements.
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return undefined;
    const visible = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => visible.set(e.target.id, e.isIntersecting));
        const first = NAV_SECTIONS.find((s) => visible.get(s.id));
        if (first) setActive(first.id);
      },
      // A band just below the sticky header: the section crossing it is "current".
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 }
    );
    NAV_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [enabled]);

  return [active, setActive];
}

/** Desktop / laptop / tablet rail: icons only from md, icons + labels from xl. */
export function Sidebar({ active, onNavigate, navEnabled = true }) {
  return (
    <aside className="hidden md:flex md:w-14 xl:w-56 shrink-0 sticky top-0 h-screen flex-col bg-slate-900 text-slate-300">
      <div className="h-14 flex items-center justify-center xl:justify-start xl:px-4 gap-2.5 border-b border-slate-800 shrink-0">
        <div className="h-8 w-8 rounded-md bg-brand-500 flex items-center justify-center text-white font-bold text-xs shrink-0">
          NS
        </div>
        <span className="hidden xl:block text-sm font-bold tracking-wide text-white">NER SMART</span>
      </div>

      <nav aria-label="Dashboard sections" className="flex-1 overflow-y-auto py-3">
        {/* While loading / on a load error there are no sections to scroll to: show the brand only. */}
        <ul className="space-y-0.5 px-2">
          {(navEnabled ? NAV_SECTIONS : []).map(({ id, label, Icon }) => {
            const isActive = active === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onNavigate(id)}
                  title={label}
                  aria-label={label}
                  aria-current={isActive ? "location" : undefined}
                  className={`w-full flex items-center justify-center xl:justify-start gap-3 rounded-md px-0 xl:px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive ? "bg-primary-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="hidden xl:inline truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        className="shrink-0 border-t border-slate-800 px-2 xl:px-4 py-3 text-center xl:text-left"
        title={
          writesEnabled
            ? "Local development: protected write actions are enabled"
            : "Read-only deployment: protected write actions are not available from this dashboard"
        }
      >
        <span
          className={`inline-block text-2xs font-bold tracking-wide px-1.5 py-0.5 rounded ${
            writesEnabled ? "bg-warn-500 text-slate-900" : "bg-slate-700 text-slate-200"
          }`}
        >
          {writesEnabled ? "WRITE" : "READ-ONLY"}
        </span>
        <span className="hidden xl:block mt-1 text-2xs text-slate-400 leading-snug">
          {writesEnabled ? "Local development mode" : "Protected writes are off in this deployment"}
        </span>
        <span className="sr-only xl:hidden">
          {writesEnabled ? "Local development mode" : "Protected writes are off in this deployment"}
        </span>
      </div>
    </aside>
  );
}

/** Mobile: horizontally scrollable section chips under the header. */
export function MobileNav({ active, onNavigate }) {
  return (
    <nav aria-label="Dashboard sections" className="md:hidden bg-white border-b border-slate-200 overflow-x-auto">
      <ul className="flex gap-1.5 px-3 py-2 w-max">
        {NAV_SECTIONS.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onNavigate(id)}
                aria-current={isActive ? "location" : undefined}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  isActive
                    ? "bg-primary-600 text-white border-primary-600"
                    : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
