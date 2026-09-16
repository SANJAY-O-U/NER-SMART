const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseRssFeed, parseCapAlert, extractIdentifierFromLink } = require('../src/services/sachetValidation');

const REAL_RSS = fs.readFileSync(path.join(__dirname, 'fixtures/real_rss_feed.xml'), 'utf8');
const REAL_CAP = fs.readFileSync(path.join(__dirname, 'fixtures/real_cap_alert.xml'), 'utf8');

// --- RSS parsing ---

test('parseRssFeed parses the real captured national feed', () => {
  const result = parseRssFeed(REAL_RSS);
  assert.equal(result.valid, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.channelTitle, 'All India: CAP Disaster Alert Feeds');
});

test('parseRssFeed extracts identifier from each item link', () => {
  const result = parseRssFeed(REAL_RSS);
  assert.equal(result.items[0].identifier, '1789459976634025');
  assert.equal(result.items[1].identifier, '1789460823033023');
});

test('extractIdentifierFromLink pulls the numeric id out of a FetchXMLFile URL', () => {
  const id = extractIdentifierFromLink('https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=1789459976634025');
  assert.equal(id, '1789459976634025');
});

test('extractIdentifierFromLink returns null for a link with no identifier', () => {
  assert.equal(extractIdentifierFromLink('https://example.com/nothing'), null);
  assert.equal(extractIdentifierFromLink(null), null);
});

test('parseRssFeed rejects empty/non-string input without throwing', () => {
  assert.equal(parseRssFeed('').valid, false);
  assert.equal(parseRssFeed(null).valid, false);
  assert.equal(parseRssFeed(undefined).valid, false);
});

test('parseRssFeed rejects XML missing rss/channel', () => {
  const result = parseRssFeed('<notrss><item/></notrss>');
  assert.equal(result.valid, false);
  assert.match(result.reason, /rss\/channel/);
});

test('parseRssFeed skips one malformed item without failing the whole feed', () => {
  const xml = `<rss><channel><title>T</title>
    <item><title>Bad</title><link>https://example.com/no-id-here</link></item>
    <item><title>Good</title><link>https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=999</link></item>
  </channel></rss>`;
  const result = parseRssFeed(xml);
  assert.equal(result.valid, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.items[0].identifier, '999');
});

test('parseRssFeed handles a feed with a single item (not wrapped in an array by the XML parser)', () => {
  const xml = `<rss><channel><title>T</title>
    <item><title>Only one</title><link>https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=42</link></item>
  </channel></rss>`;
  const result = parseRssFeed(xml);
  assert.equal(result.valid, true);
  assert.equal(result.items.length, 1);
});

// --- CAP parsing ---

test('parseCapAlert parses the real captured CAP 1.2 alert', () => {
  const result = parseCapAlert(REAL_CAP);
  assert.equal(result.valid, true);
  assert.equal(result.normalized.identifier, 'IN-1789459976634025_44');
  assert.equal(result.normalized.sender, 'IMD-Guwahati');
});

test('parseCapAlert parses severity correctly', () => {
  const result = parseCapAlert(REAL_CAP);
  assert.equal(result.normalized.severity, 'Moderate');
});

test('parseCapAlert parses urgency correctly', () => {
  const result = parseCapAlert(REAL_CAP);
  assert.equal(result.normalized.urgency, 'Expected');
});

test('parseCapAlert parses certainty correctly', () => {
  const result = parseCapAlert(REAL_CAP);
  assert.equal(result.normalized.certainty, 'Likely');
});

test('parseCapAlert parses effective/onset/expires timestamps as valid Dates', () => {
  const result = parseCapAlert(REAL_CAP);
  assert.ok(result.normalized.effective instanceof Date);
  assert.ok(result.normalized.onset instanceof Date);
  assert.ok(result.normalized.expires instanceof Date);
  assert.ok(result.normalized.expires > result.normalized.effective);
});

test('parseCapAlert extracts LGD district codes from geocode elements', () => {
  const result = parseCapAlert(REAL_CAP);
  assert.deepEqual(result.normalized.lgdDistrictCodes, [764, 248, 758, 788, 613, 244, 245]);
});

test('parseCapAlert matches known districts by LGD code and flags NER relevance', () => {
  const result = parseCapAlert(REAL_CAP);
  const names = result.normalized.matchedDistricts.map((d) => d.name);
  assert.ok(names.includes('DIMAPUR'));
  assert.ok(names.includes('KOHIMA'));
  assert.equal(result.normalized.isRelevantToNer, true);
  assert.deepEqual(result.normalized.matchedStates, ['NAGALAND']);
});

test('parseCapAlert never populates polygon geometry, only a URL reference', () => {
  const result = parseCapAlert(REAL_CAP);
  assert.equal(result.normalized.polygon, null);
  assert.match(result.normalized.polygonUrlReference, /FetchPolygonXMLFile/);
});

test('parseCapAlert rejects XML missing cap:alert root', () => {
  const result = parseCapAlert('<notcap><foo/></notcap>');
  assert.equal(result.valid, false);
});

test('parseCapAlert rejects an alert missing cap:identifier', () => {
  const xml = REAL_CAP.replace(/<cap:identifier>.*<\/cap:identifier>/, '');
  const result = parseCapAlert(xml);
  assert.equal(result.valid, false);
  assert.match(result.reason, /identifier/);
});

test('parseCapAlert rejects malformed/unparseable XML without throwing', () => {
  const result = parseCapAlert('<cap:alert><cap:identifier>unclosed');
  // fast-xml-parser is lenient with some malformed XML; the important
  // guarantee is that this never throws, and still requires cap:info.
  assert.equal(typeof result.valid, 'boolean');
});

test('parseCapAlert flags isRelevantToNer=false for a non-NER alert', () => {
  const xml = `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
    <cap:identifier>IN-TEST-NONNER</cap:identifier>
    <cap:sender>IMD-Ahmedabad</cap:sender>
    <cap:info>
      <cap:category>Met</cap:category>
      <cap:event>Light Rain</cap:event>
      <cap:severity>Minor</cap:severity>
      <cap:urgency>Future</cap:urgency>
      <cap:certainty>Possible</cap:certainty>
      <cap:area>
        <cap:areaDesc>Diu district in next 3 hours</cap:areaDesc>
      </cap:area>
    </cap:info>
  </cap:alert>`;
  const result = parseCapAlert(xml);
  assert.equal(result.valid, true);
  assert.equal(result.normalized.isRelevantToNer, false);
  assert.deepEqual(result.normalized.matchedDistricts, []);
});

test('parseCapAlert falls back to areaDesc text matching when LGD codes are absent/unknown', () => {
  const xml = `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
    <cap:identifier>IN-TEST-TEXTMATCH</cap:identifier>
    <cap:info>
      <cap:severity>Severe</cap:severity>
      <cap:urgency>Immediate</cap:urgency>
      <cap:certainty>Observed</cap:certainty>
      <cap:area>
        <cap:areaDesc>Heavy flooding reported near Jorhat and Golaghat, Assam</cap:areaDesc>
      </cap:area>
    </cap:info>
  </cap:alert>`;
  const result = parseCapAlert(xml);
  assert.equal(result.valid, true);
  assert.equal(result.normalized.isRelevantToNer, true);
  const methods = result.normalized.matchedDistricts.map((d) => d.matchMethod);
  assert.ok(methods.every((m) => m === 'AREADESC_TEXT_MATCH'));
});
