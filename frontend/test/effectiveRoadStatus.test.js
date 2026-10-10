// Dependency-free tests for the frontend STORED-STATUS display policy (src/theme/status.js).
// Run from frontend/ with `npm test` (node --test test/*.test.js). Synthetic road objects only; they
// model the importer's and the demo seed's documented shapes (backend/scripts/importRoadNetwork.js,
// backend/src/seed/seed.js): an imported road has a `source`, status "OPEN" by default and every
// physical/official/field status UNKNOWN; a demo road has `source: null`.
//
// Policy under test: the most restrictive recognised status among physical, official, field and the
// legacy/simulated `status` wins (BLOCKED > RESTRICTED > HIGH_RISK > OPEN); UNKNOWN, missing and
// unrecognised values are ignored; a legacy OPEN on an IMPORTED road is the importer default and is
// ignored; with no recognised evidence the result is UNKNOWN.
import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_PRECEDENCE,
  effectiveRoadStatus,
  isImportedRoad,
  roadStatusConflict,
  roadStatusDisplay,
  roadStatusSources,
  summarizeRoadStatuses,
} from "../src/theme/status.js";

const SRC = "SYNTHETIC IMPORT SOURCE";
const U = "UNKNOWN";
const imported = (extra = {}) => ({
  name: "imp", source: SRC, status: "OPEN", physicalStatus: U, officialStatus: U, fieldStatus: U, ...extra,
});
const demo = (extra = {}) => ({
  name: "demo", source: null, status: "OPEN", physicalStatus: U, officialStatus: U, fieldStatus: U, ...extra,
});

/* ---------- precedence order ---------- */

test("precedence order is BLOCKED > RESTRICTED > HIGH_RISK > OPEN (the backend engine's order)", () => {
  assert.deepEqual(STATUS_PRECEDENCE, ["BLOCKED", "RESTRICTED", "HIGH_RISK", "OPEN"]);
});

test("the most restrictive of several sources wins, in that order", () => {
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "OPEN", fieldStatus: "HIGH_RISK" })), "HIGH_RISK");
  assert.equal(effectiveRoadStatus(imported({ officialStatus: "HIGH_RISK", fieldStatus: "RESTRICTED" })), "RESTRICTED");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "RESTRICTED", officialStatus: "BLOCKED" })), "BLOCKED");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "OPEN", officialStatus: "OPEN", fieldStatus: "OPEN" })), "OPEN");
});

/* ---------- imported roads ---------- */

test("imported + every status UNKNOWN + legacy OPEN is UNKNOWN, never OPEN", () => {
  assert.equal(effectiveRoadStatus(imported()), "UNKNOWN");
  assert.deepEqual(roadStatusSources(imported()), [], "the importer's default OPEN is not evidence");
});

test("imported + physical/official/field missing or null + legacy OPEN is UNKNOWN", () => {
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: undefined, officialStatus: undefined, fieldStatus: undefined })), "UNKNOWN");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: null, officialStatus: null, fieldStatus: null })), "UNKNOWN");
});

test("imported + explicit legacy BLOCKED / RESTRICTED stays visible", () => {
  assert.equal(effectiveRoadStatus(imported({ status: "BLOCKED" })), "BLOCKED");
  assert.equal(effectiveRoadStatus(imported({ status: "RESTRICTED" })), "RESTRICTED");
  assert.equal(effectiveRoadStatus(imported({ status: "blocked", physicalStatus: undefined })), "BLOCKED");
});

test("imported + explicit physical status is used", () => {
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "OPEN" })), "OPEN");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "BLOCKED" })), "BLOCKED");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "HIGH_RISK" })), "HIGH_RISK");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "RESTRICTED" })), "RESTRICTED");
});

test("official and field statuses count as evidence (an official/field BLOCKED is never shown as UNKNOWN)", () => {
  assert.equal(effectiveRoadStatus(imported({ officialStatus: "BLOCKED" })), "BLOCKED");
  assert.equal(effectiveRoadStatus(imported({ fieldStatus: "BLOCKED" })), "BLOCKED");
  assert.equal(effectiveRoadStatus(imported({ fieldStatus: "RESTRICTED" })), "RESTRICTED");
  assert.equal(effectiveRoadStatus(imported({ officialStatus: "OPEN" })), "OPEN");
});

/* ---------- the case Phase 10 changed: a block is never hidden by an OPEN ---------- */

test("physical OPEN never hides an explicit legacy / simulated BLOCKED or RESTRICTED", () => {
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "OPEN", status: "BLOCKED" })), "BLOCKED");
  assert.equal(effectiveRoadStatus(demo({ physicalStatus: "OPEN", status: "BLOCKED" })), "BLOCKED");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "OPEN", status: "RESTRICTED" })), "RESTRICTED");
});

test("physical OPEN never hides an official or field BLOCKED", () => {
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "OPEN", officialStatus: "BLOCKED" })), "BLOCKED");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "OPEN", fieldStatus: "BLOCKED" })), "BLOCKED");
});

test("an explicit physical BLOCKED is not diluted by a legacy OPEN", () => {
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "BLOCKED", status: "OPEN" })), "BLOCKED");
  assert.equal(effectiveRoadStatus(demo({ physicalStatus: "BLOCKED", status: "OPEN" })), "BLOCKED");
});

/* ---------- demo roads ---------- */

test("demo road: legacy OPEN is its own state", () => {
  assert.equal(effectiveRoadStatus(demo()), "OPEN");
  assert.equal(effectiveRoadStatus(demo({ status: "RESTRICTED" })), "RESTRICTED");
});

test("demo road simulated BLOCKED stays BLOCKED", () => {
  assert.equal(effectiveRoadStatus(demo({ status: "BLOCKED" })), "BLOCKED");
});

test("missing, null and empty source are treated as demo", () => {
  for (const source of [undefined, null, "", "   "]) {
    const road = { physicalStatus: U, status: "BLOCKED", source };
    assert.equal(isImportedRoad(road), false, JSON.stringify(source));
    assert.equal(effectiveRoadStatus(road), "BLOCKED");
    assert.equal(effectiveRoadStatus({ ...road, status: "OPEN" }), "OPEN");
  }
});

/* ---------- missing / unrecognised ---------- */

test("missing or unrecognised statuses are never promoted to OPEN", () => {
  assert.equal(effectiveRoadStatus({}), "UNKNOWN");
  assert.equal(effectiveRoadStatus(null), "UNKNOWN");
  assert.equal(effectiveRoadStatus(undefined), "UNKNOWN");
  assert.equal(effectiveRoadStatus(demo({ status: undefined })), "UNKNOWN");
  assert.equal(effectiveRoadStatus(demo({ status: "SOMETHING_ELSE" })), "UNKNOWN");
  assert.equal(effectiveRoadStatus(imported({ status: "SOMETHING_ELSE" })), "UNKNOWN");
  assert.equal(effectiveRoadStatus(demo({ status: "RISKY" })), "UNKNOWN", "not a value the schema allows");
  assert.equal(effectiveRoadStatus(demo({ physicalStatus: "GARBAGE", status: undefined })), "UNKNOWN");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "GARBAGE" })), "UNKNOWN");
  assert.equal(effectiveRoadStatus(imported({ officialStatus: "GARBAGE", fieldStatus: 42 })), "UNKNOWN");
});

test("case and surrounding whitespace in stored values are tolerated", () => {
  assert.equal(effectiveRoadStatus(imported({ fieldStatus: " blocked " })), "BLOCKED");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "open" })), "OPEN");
});

/* ---------- conflicts shown in the popup ---------- */

test("sources that disagree are reported, with the most restrictive as the effective status", () => {
  const c = roadStatusConflict(imported({ physicalStatus: "OPEN", fieldStatus: "BLOCKED" }));
  assert.equal(c.conflict, true);
  assert.equal(c.effective, "BLOCKED");
  assert.deepEqual(c.sources.map((s) => [s.label, s.status]), [["Physical", "OPEN"], ["Field", "BLOCKED"]]);
});

test("a simulated block on a road with an explicit physical OPEN is reported as a conflict", () => {
  const c = roadStatusConflict(demo({ physicalStatus: "OPEN", status: "BLOCKED" }));
  assert.equal(c.conflict, true);
  assert.equal(c.effective, "BLOCKED");
});

test("no conflict when sources agree, or when the only other value is the importer's default OPEN", () => {
  assert.equal(roadStatusConflict(imported({ physicalStatus: "BLOCKED", status: "BLOCKED" })).conflict, false);
  assert.equal(roadStatusConflict(imported({ physicalStatus: "BLOCKED", status: "OPEN" })).conflict, false);
  assert.equal(roadStatusConflict(imported()).conflict, false);
  assert.equal(roadStatusConflict({}).conflict, false);
});

/* ---------- KPI counts share the same policy ---------- */

test("summarizeRoadStatuses counts by effective stored status and keeps UNKNOWN separate", () => {
  const roads = [
    imported(), imported(), imported(),                          // 3 unverified
    imported({ officialStatus: "BLOCKED" }),                    // blocked (official)
    imported({ fieldStatus: "RESTRICTED" }),                    // restricted
    imported({ physicalStatus: "HIGH_RISK" }),                  // high risk
    demo(),                                                     // open (demo)
    demo({ physicalStatus: "OPEN", status: "BLOCKED" }),        // blocked (simulated, not hidden by OPEN)
  ];
  const s = summarizeRoadStatuses(roads);
  assert.deepEqual(s, { total: 8, blocked: 2, restricted: 1, highRisk: 1, open: 1, unknown: 3 });
  assert.equal(s.blocked + s.restricted + s.highRisk + s.open + s.unknown, s.total);
});

test("the blocked count includes roads the old legacy-only KPI missed", () => {
  const road = imported({ physicalStatus: "BLOCKED", status: "OPEN" }); // legacy status is OPEN
  assert.notEqual(road.status, "BLOCKED");
  assert.equal(summarizeRoadStatuses([road]).blocked, 1);
});

test("summarizeRoadStatuses tolerates a non-array and reports zeros", () => {
  assert.deepEqual(summarizeRoadStatuses(undefined), { total: 0, blocked: 0, restricted: 0, highRisk: 0, open: 0, unknown: 0 });
  assert.deepEqual(summarizeRoadStatuses(null), { total: 0, blocked: 0, restricted: 0, highRisk: 0, open: 0, unknown: 0 });
});

test("all 260 importer-default roads are unverified: none blocked, none open", () => {
  const s = summarizeRoadStatuses(Array.from({ length: 260 }, () => imported()));
  assert.deepEqual(s, { total: 260, blocked: 0, restricted: 0, highRisk: 0, open: 0, unknown: 260 });
});

/* ---------- display ---------- */

test("an UNKNOWN effective status renders neutral, with a ? glyph, an UNKNOWN label and a darker gray", () => {
  const info = roadStatusDisplay(effectiveRoadStatus(imported()));
  assert.equal(info.label, "UNKNOWN");
  assert.equal(info.glyph, "?");
  assert.equal(info.hex, "#64748b");
});

test("UNKNOWN is visually distinct from every status color", () => {
  const unknownHex = roadStatusDisplay("UNKNOWN").hex;
  for (const s of STATUS_PRECEDENCE) assert.notEqual(roadStatusDisplay(s).hex, unknownHex, s);
});
