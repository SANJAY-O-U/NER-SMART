/**
 * SACHET Service
 * --------------
 * Orchestrates the real, verified (Phase 3A) NDMA SACHET endpoints:
 *
 *   RSS feed  -> https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml
 *   CAP detail -> https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier={id}
 *
 * No credentials required (verified live in Phase 3A). Implements the
 * official ETag-based conditional-request behavior documented in
 * SACHET's own "CAP XML Feed Integration Guide for Agencies".
 *
 * Only fetches full CAP detail for RSS items that look NER-relevant by a
 * coarse title/author text check first — fetching all ~80+ national
 * items' CAP detail on every poll would be needlessly heavy and exactly
 * the kind of aggressive polling the mission says to avoid.
 */

const { parseRssFeed, parseCapAlert } = require('./sachetValidation');
const { NER_STATES } = require('../config/nerGeography');
const { registerSource } = require('./dataSourceRegistry');

const RSS_URL = 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml';
const CAP_DETAIL_URL = (id) => `https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=${encodeURIComponent(id)}`;
const REQUEST_TIMEOUT_MS = 10000;

// In-memory ETag store. Resets on server restart — acceptable for MVP;
// worst case after a restart is one extra full fetch, not incorrect data.
// A persistent store would be a reasonable future upgrade, not a Phase
// 3B requirement.
const etagStore = new Map(); // url -> etag string

// Coarse pre-filter keywords: NER state names + a few well-known NER
// city/agency names that show up as CAP `sender` (e.g. "IMD Guwahati",
// "IMD Agartala", "ASDMA" = Assam State Disaster Management Authority).
// This is intentionally broad (over-match is fine, it just means an
// extra CAP fetch that turns out non-relevant; under-match would silently
// drop a real NER alert, which is the worse failure).
const NER_HINT_WORDS = [
  ...NER_STATES,
  'GUWAHATI',
  'AGARTALA',
  'IMPHAL',
  'SHILLONG',
  'AIZAWL',
  'KOHIMA',
  'ITANAGAR',
  'GANGTOK',
  'DIMAPUR',
  'ASDMA',
  'SDMA',
];

function looksNerRelevant(item) {
  const haystack = `${item.title || ''} ${item.author || ''}`.toUpperCase();
  return NER_HINT_WORDS.some((w) => haystack.includes(w));
}

async function fetchWithTimeout(url, { fetchFn = fetch, headers = {} } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Fetches the national RSS feed with ETag support. Returns:
 *   { status: 'LIVE', changed: true, items: [...] }   - new/changed content
 *   { status: 'LIVE', changed: false, items: [] }      - 304 Not Modified
 *   { status: 'UNAVAILABLE', changed: false, items: [], error }
 */
async function fetchRssFeed({ fetchFn } = {}) {
  const headers = {};
  const storedEtag = etagStore.get(RSS_URL);
  if (storedEtag) headers['If-None-Match'] = storedEtag;

  let response;
  try {
    response = await fetchWithTimeout(RSS_URL, { fetchFn, headers });
  } catch (err) {
    registerSource('NDMA_SACHET', {
      status: 'UNAVAILABLE',
      source: 'NDMA SACHET National RSS Feed',
      coverage: 'India (filtered to NER states)',
      confidence: null,
      error: err.name === 'AbortError' ? 'timeout' : err.message,
    });
    return { status: 'UNAVAILABLE', changed: false, items: [], error: err.message };
  }

  if (response.status === 304) {
    registerSource('NDMA_SACHET', {
      status: 'LIVE',
      source: 'NDMA SACHET National RSS Feed',
      coverage: 'India (filtered to NER states)',
      confidence: 0.9,
    });
    return { status: 'LIVE', changed: false, items: [] };
  }

  if (!response.ok) {
    registerSource('NDMA_SACHET', {
      status: 'UNAVAILABLE',
      source: 'NDMA SACHET National RSS Feed',
      coverage: 'India (filtered to NER states)',
      confidence: null,
      error: `HTTP ${response.status}`,
    });
    return { status: 'UNAVAILABLE', changed: false, items: [], error: `HTTP ${response.status}` };
  }

  const newEtag = response.headers && typeof response.headers.get === 'function' ? response.headers.get('etag') : null;
  if (newEtag) etagStore.set(RSS_URL, newEtag);

  const body = await response.text();
  const parsed = parseRssFeed(body);

  if (!parsed.valid) {
    registerSource('NDMA_SACHET', {
      status: 'UNAVAILABLE',
      source: 'NDMA SACHET National RSS Feed',
      coverage: 'India (filtered to NER states)',
      confidence: null,
      error: `malformed feed: ${parsed.reason}`,
    });
    return { status: 'UNAVAILABLE', changed: false, items: [], error: parsed.reason };
  }

  registerSource('NDMA_SACHET', {
    status: 'LIVE',
    source: 'NDMA SACHET National RSS Feed',
    coverage: 'India (filtered to NER states)',
    confidence: 0.9,
  });

  const nerCandidates = parsed.items.filter(looksNerRelevant);
  return { status: 'LIVE', changed: true, items: nerCandidates, totalItemsInFeed: parsed.items.length };
}

/**
 * Fetches and parses a single alert's full CAP detail. One bad alert
 * must not throw — callers should continue processing the rest of the
 * batch on failure here.
 */
async function fetchCapDetail(identifier, { fetchFn } = {}) {
  let response;
  try {
    response = await fetchWithTimeout(CAP_DETAIL_URL(identifier), { fetchFn });
  } catch (err) {
    return { valid: false, reason: err.name === 'AbortError' ? 'timeout' : err.message, normalized: null };
  }

  if (!response.ok) {
    return { valid: false, reason: `HTTP ${response.status}`, normalized: null };
  }

  const body = await response.text();
  const parsed = parseCapAlert(body);
  if (!parsed.valid) return parsed;

  return {
    ...parsed,
    normalized: {
      ...parsed.normalized,
      sourceUrl: CAP_DETAIL_URL(identifier),
      rawCapXml: body,
    },
  };
}

/**
 * Full ingestion pass: fetch RSS, filter to NER-relevant candidates,
 * fetch+parse each candidate's CAP detail. Returns a batch result;
 * persistence (dedup/upsert) is the caller's (sachetController /
 * scheduling job's) responsibility, not this service's — keeps this
 * layer a pure orchestration/fetch layer, consistent with weatherService.
 */
async function ingestSachetAlerts({ fetchFn } = {}) {
  const rssResult = await fetchRssFeed({ fetchFn });

  if (rssResult.status === 'UNAVAILABLE') {
    return { status: 'UNAVAILABLE', alerts: [], errors: [rssResult.error] };
  }
  if (!rssResult.changed) {
    return { status: 'LIVE', unchanged: true, alerts: [], errors: [] };
  }

  const alerts = [];
  const errors = [];

  for (const item of rssResult.items) {
    const detail = await fetchCapDetail(item.identifier, { fetchFn });
    if (!detail.valid) {
      errors.push({ identifier: item.identifier, reason: detail.reason });
      continue; // isolate one bad alert — keep processing the rest
    }
    if (!detail.normalized.isRelevantToNer) {
      continue; // coarse RSS-level filter over-matches by design; drop non-NER here
    }
    alerts.push({ ...detail.normalized, rssGuid: item.guid });
  }

  return { status: 'LIVE', unchanged: false, alerts, errors, totalCandidates: rssResult.items.length };
}

/** Test/ops helper: clears the in-memory ETag store. */
function resetEtagStore() {
  etagStore.clear();
}

module.exports = {
  fetchRssFeed,
  fetchCapDetail,
  ingestSachetAlerts,
  looksNerRelevant,
  resetEtagStore,
  RSS_URL,
  CAP_DETAIL_URL,
};
