/**
 * Pure parsing/normalization for NDMA SACHET's RSS feed and CAP 1.2 XML
 * alert detail. No network calls — built and tested against the REAL
 * response structures captured during the Phase 3A audit
 * (sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml and
 * .../FetchXMLFile?identifier=...).
 *
 * Uses fast-xml-parser (safe: pure-JS, no DTD/external-entity resolution)
 * rather than hand-rolled regex, per the mission's "validate XML input,
 * prevent malformed external content from causing unsafe processing"
 * requirement.
 */

const { XMLParser } = require('fast-xml-parser');
const { findDistrictNamesInText, lookupDistrictByLgdCode, isNerState } = require('../config/nerGeography');

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: false, // keep cap: prefixes explicit — matches the real structure, avoids ambiguity
  parseTagValue: false, // keep everything as strings; we parse numbers/dates ourselves, deliberately
});

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function nonEmpty(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extracts the numeric SACHET identifier from an RSS item's <link>,
 * e.g. ".../FetchXMLFile?identifier=1789459976634025" -> "1789459976634025".
 */
function extractIdentifierFromLink(link) {
  if (!link) return null;
  const match = String(link).match(/identifier=(\d+)/);
  return match ? match[1] : null;
}

/**
 * Parses the SACHET national RSS feed into a list of lightweight alert
 * references (NOT full CAP detail — that requires a separate fetch per
 * item). Filters nothing itself; NER relevance filtering happens in
 * sachetService.js so this module stays a pure parser.
 */
function parseRssFeed(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    return { valid: false, reason: 'empty or non-string input', items: [] };
  }

  let doc;
  try {
    doc = parser.parse(xmlString);
  } catch (err) {
    return { valid: false, reason: `XML parse error: ${err.message}`, items: [] };
  }

  const channel = doc && doc.rss && doc.rss.channel;
  if (!channel) {
    return { valid: false, reason: 'missing rss/channel element', items: [] };
  }

  const rawItems = toArray(channel.item);
  const items = [];
  const errors = [];

  for (const raw of rawItems) {
    const link = nonEmpty(raw.link);
    const identifier = extractIdentifierFromLink(link);
    if (!identifier) {
      errors.push('item missing a parseable identifier in <link>');
      continue; // one bad item does not fail the whole feed
    }
    items.push({
      title: nonEmpty(raw.title),
      category: nonEmpty(raw.category),
      link,
      author: nonEmpty(raw.author),
      guid: nonEmpty(raw.guid),
      pubDate: nonEmpty(raw.pubDate) ? new Date(raw.pubDate) : null,
      identifier,
    });
  }

  return {
    valid: true,
    reason: null,
    items,
    skipped: errors.length,
    channelTitle: nonEmpty(channel.title),
    channelPubDate: nonEmpty(channel.pubDate) ? new Date(channel.pubDate) : null,
  };
}

/**
 * Parses a single CAP 1.2 alert document (the response from
 * FetchXMLFile?identifier=...) into our normalized DisasterAlert shape.
 * Rejects malformed input rather than guessing at missing structure.
 */
function parseCapAlert(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    return { valid: false, reason: 'empty or non-string input' };
  }

  let doc;
  try {
    doc = parser.parse(xmlString);
  } catch (err) {
    return { valid: false, reason: `XML parse error: ${err.message}` };
  }

  const alert = doc && doc['cap:alert'];
  if (!alert) {
    return { valid: false, reason: 'missing cap:alert root element' };
  }

  const identifier = nonEmpty(alert['cap:identifier']);
  if (!identifier) {
    return { valid: false, reason: 'missing cap:identifier' };
  }

  // CAP allows multiple <info> blocks (one per language); we use the
  // first, matching what was observed live (single en-IN info block).
  const infoRaw = toArray(alert['cap:info'])[0];
  if (!infoRaw) {
    return { valid: false, reason: 'missing cap:info block' };
  }

  const areaRaw = toArray(infoRaw['cap:area'])[0] || {};
  const geocodes = toArray(areaRaw['cap:geocode']);
  const lgdCodes = [];
  for (const g of geocodes) {
    const valueName = nonEmpty(g && g['cap:valueName']);
    const value = nonEmpty(g && g['cap:value']);
    if (valueName === 'LGD District Code' && value) {
      const num = Number(value);
      if (Number.isFinite(num)) lgdCodes.push(num);
    }
  }

  const areaDesc = nonEmpty(areaRaw['cap:areaDesc']);

  // District matching: LGD code first (authoritative), areaDesc text as
  // secondary/supplementary evidence — per the mission's stated
  // preference order.
  const matchedDistricts = [];
  const seen = new Set();
  for (const code of lgdCodes) {
    const d = lookupDistrictByLgdCode(code);
    if (d && !seen.has(`${d.name}|${d.state}`)) {
      matchedDistricts.push({ name: d.name, state: d.state, lgdCode: code, matchMethod: 'LGD_DISTRICT_MATCH' });
      seen.add(`${d.name}|${d.state}`);
    }
  }
  if (areaDesc) {
    for (const d of findDistrictNamesInText(areaDesc)) {
      const key = `${d.name}|${d.state}`;
      if (!seen.has(key)) {
        matchedDistricts.push({ ...d, matchMethod: 'AREADESC_TEXT_MATCH' });
        seen.add(key);
      }
    }
  }

  const matchedStates = [...new Set(matchedDistricts.map((d) => d.state))];
  const isRelevantToNer = matchedStates.some((s) => isNerState(s));

  const parameters = toArray(infoRaw['cap:parameter']);
  let polygonUrl = null;
  for (const p of parameters) {
    if (nonEmpty(p && p['cap:valueName']) === 'Polygon URL') {
      polygonUrl = nonEmpty(p['cap:value']);
    }
  }

  const parseDate = (v) => {
    const s = nonEmpty(v);
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const normalized = {
    identifier,
    rssGuid: null, // filled in by the caller from the RSS item, not present in the CAP doc itself
    sender: nonEmpty(alert['cap:sender']),
    sent: parseDate(alert['cap:sent']),
    status: nonEmpty(alert['cap:status']),
    msgType: nonEmpty(alert['cap:msgType']),
    category: nonEmpty(infoRaw['cap:category']),
    event: nonEmpty(infoRaw['cap:event']),
    urgency: nonEmpty(infoRaw['cap:urgency']),
    severity: nonEmpty(infoRaw['cap:severity']),
    certainty: nonEmpty(infoRaw['cap:certainty']),
    effective: parseDate(infoRaw['cap:effective']),
    onset: parseDate(infoRaw['cap:onset']),
    expires: parseDate(infoRaw['cap:expires']),
    headline: nonEmpty(infoRaw['cap:headline']),
    description: nonEmpty(infoRaw['cap:description']),
    instruction: nonEmpty(infoRaw['cap:instruction']),
    areaDesc,
    lgdDistrictCodes: lgdCodes,
    matchedDistricts,
    matchedStates,
    polygon: null, // never populated from a URL reference alone — see Phase 3A audit
    polygonUrlReference: polygonUrl, // kept separately: a reference, not verified geometry
    isRelevantToNer,
  };

  return { valid: true, reason: null, normalized };
}

module.exports = { parseRssFeed, parseCapAlert, extractIdentifierFromLink };
