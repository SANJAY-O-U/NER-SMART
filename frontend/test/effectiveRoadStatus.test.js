// Dependency-free tests: run with `node --test frontend/test/effectiveRoadStatus.test.js`.
// Synthetic road objects only; they model the importer's and the demo seed's documented shapes.
import test from "node:test";
import assert from "node:assert/strict";
import { effectiveRoadStatus, isImportedRoad, roadStatusDisplay } from "../src/theme/status.js";

const SRC = "SYNTHETIC IMPORT SOURCE";
const imported = (extra = {}) => ({ name: "imp", source: SRC, physicalStatus: "UNKNOWN", status: "OPEN", ...extra });
const demo = (extra = {}) => ({ name: "demo", source: null, physicalStatus: "UNKNOWN", status: "OPEN", ...extra });

test("imported + physical UNKNOWN + legacy OPEN is UNKNOWN, never OPEN", () => {
  assert.equal(effectiveRoadStatus(imported()), "UNKNOWN");
});

test("imported + physical missing + legacy OPEN is UNKNOWN", () => {
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: undefined })), "UNKNOWN");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: null })), "UNKNOWN");
});

test("imported + explicit legacy BLOCKED / RESTRICTED stays visible", () => {
  assert.equal(effectiveRoadStatus(imported({ status: "BLOCKED" })), "BLOCKED");
  assert.equal(effectiveRoadStatus(imported({ status: "RESTRICTED" })), "RESTRICTED");
  assert.equal(effectiveRoadStatus(imported({ status: "blocked", physicalStatus: undefined })), "BLOCKED");
});

test("imported + explicit physical status wins over legacy", () => {
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "OPEN" })), "OPEN");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "BLOCKED", status: "OPEN" })), "BLOCKED");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "HIGH_RISK" })), "HIGH_RISK");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "RESTRICTED" })), "RESTRICTED");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "OPEN", status: "BLOCKED" })), "OPEN");
});

test("demo road keeps legacy-status behavior", () => {
  assert.equal(effectiveRoadStatus(demo()), "OPEN");
  assert.equal(effectiveRoadStatus(demo({ status: "RESTRICTED" })), "RESTRICTED");
});

test("demo road simulated BLOCKED stays BLOCKED", () => {
  assert.equal(effectiveRoadStatus(demo({ status: "BLOCKED" })), "BLOCKED");
});

test("missing, null and empty source are treated as demo", () => {
  for (const source of [undefined, null, "", "   "]) {
    const road = { physicalStatus: "UNKNOWN", status: "BLOCKED", source };
    assert.equal(isImportedRoad(road), false, JSON.stringify(source));
    assert.equal(effectiveRoadStatus(road), "BLOCKED");
    assert.equal(effectiveRoadStatus({ ...road, status: "OPEN" }), "OPEN");
  }
});

test("missing or unrecognised statuses are never promoted to OPEN", () => {
  assert.equal(effectiveRoadStatus({}), "UNKNOWN");
  assert.equal(effectiveRoadStatus(null), "UNKNOWN");
  assert.equal(effectiveRoadStatus(undefined), "UNKNOWN");
  assert.equal(effectiveRoadStatus(demo({ status: undefined })), "UNKNOWN");
  assert.equal(effectiveRoadStatus(demo({ status: "SOMETHING_ELSE" })), "UNKNOWN");
  assert.equal(effectiveRoadStatus(imported({ status: "SOMETHING_ELSE" })), "UNKNOWN");
  assert.equal(effectiveRoadStatus(demo({ physicalStatus: "GARBAGE", status: undefined })), "UNKNOWN");
  assert.equal(effectiveRoadStatus(imported({ physicalStatus: "GARBAGE" })), "UNKNOWN");
});

test("an UNKNOWN effective status renders neutral, with a ? glyph and an UNKNOWN label", () => {
  const info = roadStatusDisplay(effectiveRoadStatus(imported()));
  assert.equal(info.label, "UNKNOWN");
  assert.equal(info.glyph, "?");
  assert.equal(info.hex, "#94a3b8");
});
