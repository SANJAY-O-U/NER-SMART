// Dependency-free tests for road line styling (src/components/map/roadStyle.js) and the contrast
// reasoning behind the UNKNOWN stroke color. Run from frontend/ with `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CASING_COLOR,
  CASING_EXTRA,
  UNKNOWN_DASH,
  baseRoadWeight,
  roadCasingWeight,
  roadLineWeight,
} from "../src/components/map/roadStyle.js";
import { roadStatusDisplay } from "../src/theme/status.js";

// WCAG 2.x relative luminance / contrast ratio.
const lin = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("line weight grows with zoom and never shrinks as you zoom in", () => {
  let previous = 0;
  for (let z = 1; z <= 18; z += 1) {
    const w = baseRoadWeight(z);
    assert.ok(w >= previous, `zoom ${z}`);
    previous = w;
  }
  assert.equal(baseRoadWeight(5), 2);
  assert.equal(baseRoadWeight(7), 3, "the dashboard's default zoom keeps the previous 3px weight");
  assert.equal(baseRoadWeight(9), 4);
  assert.equal(baseRoadWeight(12), 5);
});

test("weight is capped so zoomed-in roads do not obscure each other", () => {
  assert.equal(baseRoadWeight(18), 5);
  assert.ok(roadLineWeight("BLOCKED", 18) <= 7);
});

test("an unknown or invalid zoom falls back to the previous fixed weight", () => {
  for (const z of [undefined, null, NaN, "abc"]) assert.equal(baseRoadWeight(z), 3);
});

test("restrictive statuses are heavier than UNKNOWN / OPEN at every zoom (status is not color-only)", () => {
  for (let z = 1; z <= 18; z += 1) {
    assert.ok(roadLineWeight("BLOCKED", z) > roadLineWeight("UNKNOWN", z), `BLOCKED vs UNKNOWN at ${z}`);
    assert.ok(roadLineWeight("HIGH_RISK", z) > roadLineWeight("OPEN", z), `HIGH_RISK vs OPEN at ${z}`);
    assert.equal(roadLineWeight("UNKNOWN", z), roadLineWeight("OPEN", z));
  }
});

test("the casing is always wider than the line it sits under, by a thin fixed margin", () => {
  for (let z = 1; z <= 18; z += 1) {
    for (const s of ["UNKNOWN", "OPEN", "RESTRICTED", "HIGH_RISK", "BLOCKED"]) {
      const line = roadLineWeight(s, z);
      assert.equal(roadCasingWeight(line), line + CASING_EXTRA);
    }
  }
  assert.equal(CASING_EXTRA, 3);
  assert.equal(CASING_COLOR, "#ffffff");
});

test("UNKNOWN keeps a dashed pattern (the 'unverified' cue)", () => {
  assert.equal(UNKNOWN_DASH, "8 6");
});

test("the UNKNOWN stroke meets 4.5:1 against the white casing it is drawn on; the old gray did not", () => {
  const now = roadStatusDisplay("UNKNOWN").hex;
  assert.ok(contrast(now, CASING_COLOR) >= 4.5, `current ${now}: ${contrast(now, CASING_COLOR).toFixed(2)}`);
  assert.ok(contrast("#94a3b8", CASING_COLOR) < 3, "the former #94a3b8 is below 3:1 against white");
});

test("the UNKNOWN stroke meets 3:1 against the OSM land and farmland ground colors", () => {
  const now = roadStatusDisplay("UNKNOWN").hex;
  for (const [name, ground] of [["land", "#f2efe9"], ["farmland", "#cdebb0"]]) {
    assert.ok(contrast(now, ground) >= 3, `${name}: ${contrast(now, ground).toFixed(2)}`);
  }
});
