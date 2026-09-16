const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sachetService = require('../src/services/sachetService');

const REAL_RSS = fs.readFileSync(path.join(__dirname, 'fixtures/real_rss_feed.xml'), 'utf8');
const REAL_CAP = fs.readFileSync(path.join(__dirname, 'fixtures/real_cap_alert.xml'), 'utf8');

function fakeResponse({ status = 200, body = '', headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => body,
  };
}

test('looksNerRelevant matches on NER state names and known agency/sender names', () => {
  assert.equal(sachetService.looksNerRelevant({ title: 'Flood in Assam', author: '' }), true);
  assert.equal(sachetService.looksNerRelevant({ title: '', author: 'IMD Guwahati' }), true);
  assert.equal(sachetService.looksNerRelevant({ title: 'Rain over Gujarat', author: 'IMD Ahmedabad' }), false);
});

test('fetchRssFeed returns items and sets an ETag on first fetch', async () => {
  sachetService.resetEtagStore();
  const fetchFn = async () => fakeResponse({ status: 200, body: REAL_RSS, headers: { etag: '"abc123"' } });
  const result = await sachetService.fetchRssFeed({ fetchFn });
  assert.equal(result.status, 'LIVE');
  assert.equal(result.changed, true);
  assert.ok(result.items.length >= 1); // the Guwahati item should pass the NER filter
});

test('fetchRssFeed sends If-None-Match on the second call and handles a 304 as unchanged', async () => {
  sachetService.resetEtagStore();
  let capturedHeaders = null;
  const fetchFn = async (url, opts) => {
    if (!capturedHeaders) {
      capturedHeaders = opts.headers;
      return fakeResponse({ status: 200, body: REAL_RSS, headers: { etag: '"v1"' } });
    }
    capturedHeaders = opts.headers;
    return fakeResponse({ status: 304 });
  };

  await sachetService.fetchRssFeed({ fetchFn }); // first call, stores ETag
  const second = await sachetService.fetchRssFeed({ fetchFn }); // second call, should send If-None-Match

  assert.equal(capturedHeaders['If-None-Match'], '"v1"');
  assert.equal(second.status, 'LIVE');
  assert.equal(second.changed, false);
  assert.deepEqual(second.items, []);
});

test('fetchRssFeed handles a network error without throwing', async () => {
  sachetService.resetEtagStore();
  const fetchFn = async () => {
    throw new Error('ECONNRESET');
  };
  const result = await sachetService.fetchRssFeed({ fetchFn });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.ok(result.error);
});

test('fetchRssFeed handles an HTTP error status without throwing', async () => {
  sachetService.resetEtagStore();
  const fetchFn = async () => fakeResponse({ status: 500 });
  const result = await sachetService.fetchRssFeed({ fetchFn });
  assert.equal(result.status, 'UNAVAILABLE');
});

test('fetchCapDetail parses a successful response', async () => {
  const fetchFn = async () => fakeResponse({ status: 200, body: REAL_CAP });
  const result = await sachetService.fetchCapDetail('1789459976634025', { fetchFn });
  assert.equal(result.valid, true);
  assert.equal(result.normalized.identifier, 'IN-1789459976634025_44');
  assert.ok(result.normalized.sourceUrl.includes('1789459976634025'));
});

test('fetchCapDetail handles a failure gracefully (does not throw)', async () => {
  const fetchFn = async () => fakeResponse({ status: 404 });
  const result = await sachetService.fetchCapDetail('999', { fetchFn });
  assert.equal(result.valid, false);
});

test('ingestSachetAlerts isolates one bad CAP fetch and still processes the rest', async () => {
  sachetService.resetEtagStore();
  let callCount = 0;
  const fetchFn = async (url) => {
    callCount += 1;
    if (url.includes('rss/rss_india.xml')) {
      return fakeResponse({ status: 200, body: REAL_RSS, headers: { etag: '"v1"' } });
    }
    if (url.includes('1789459976634025')) {
      return fakeResponse({ status: 200, body: REAL_CAP }); // Guwahati item — succeeds
    }
    return fakeResponse({ status: 500 }); // the other (non-NER, filtered out anyway) item
  };

  const result = await sachetService.ingestSachetAlerts({ fetchFn });
  assert.equal(result.status, 'LIVE');
  assert.ok(result.alerts.length >= 1);
  assert.equal(result.alerts[0].identifier, 'IN-1789459976634025_44');
});

test('ingestSachetAlerts returns UNAVAILABLE cleanly when the RSS feed itself fails', async () => {
  sachetService.resetEtagStore();
  const fetchFn = async () => {
    throw new Error('network down');
  };
  const result = await sachetService.ingestSachetAlerts({ fetchFn });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.alerts.length, 0);
});

test('ingestSachetAlerts drops CAP-relevant-looking items that turn out non-NER after full parse', async () => {
  sachetService.resetEtagStore();
  // RSS item mentions "Guwahati" in author (passes coarse filter) but
  // the full CAP detail turns out to describe a non-NER area — the
  // second-stage isRelevantToNer check should drop it.
  const rssWithMislabeledItem = `<rss><channel><title>T</title>
    <item><title>x</title><author>IMD Guwahati (mislabeled)</author><link>https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=555</link></item>
  </channel></rss>`;
  const nonNerCap = `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
    <cap:identifier>IN-555</cap:identifier>
    <cap:info><cap:severity>Minor</cap:severity><cap:area><cap:areaDesc>Diu district</cap:areaDesc></cap:area></cap:info>
  </cap:alert>`;

  const fetchFn = async (url) => {
    if (url.includes('rss/rss_india.xml')) return fakeResponse({ status: 200, body: rssWithMislabeledItem });
    return fakeResponse({ status: 200, body: nonNerCap });
  };

  const result = await sachetService.ingestSachetAlerts({ fetchFn });
  assert.equal(result.alerts.length, 0);
});
