/**
 * AI Incident Analysis Service
 * ----------------------------
 * INPUT -> PREPROCESSING -> AI ANALYSIS -> CLASSIFICATION -> SEVERITY
 * -> CONFIDENCE -> STRUCTURED OUTPUT
 *
 * This is intentionally the ONLY place that knows how incident reports get
 * turned into a classification/severity/confidence result. Controllers call
 * `analyzeIncident()` and never re-implement this logic.
 *
 * Two modes, always returning the SAME shape:
 *   REAL_AI       - used only if ANTHROPIC_API_KEY is set in .env
 *   DEMO_FALLBACK - deterministic local scoring, always available, never
 *                   fails, never calls the network. This is what runs in
 *                   the demo unless a real key is configured.
 *
 * Phase 5: this output is AI ASSISTANCE, not authoritative accessibility
 * state. `severity`/`confidence` here are a hint for the operator, never
 * copied over the incident's own authoritative `severity` field and never
 * fed into the deterministic accessibility engine — see
 * accessibilityEvidence.js's buildIncidentEvidence, which reads only
 * incident.severity (driver-submitted or default), and
 * incidentController.js's createIncident, which no longer overwrites it
 * from this result.
 *
 * Output shape (matches SIH26002 mission spec, extended in Phase 5 with
 * rationale/model/generatedAt for operator explainability/provenance):
 * {
 *   classification: string,
 *   severity: 'LOW' | 'MEDIUM' | 'HIGH',
 *   confidence: number (0-1),
 *   summary: string,
 *   rationale: string,
 *   model: string,
 *   generatedAt: Date,
 *   source: 'REAL_AI' | 'DEMO_FALLBACK'
 * }
 */

const REQUEST_TIMEOUT_MS = 8000; // same convention as weatherApiService.js/weatherService.js/sachetService.js
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const VALID_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'];

const HIGH_KEYWORDS = ['severe', 'collapsed', 'major', 'blocked', 'landslide', 'flood', 'washed away', 'impassable', 'critical', 'death', 'injur'];
const MEDIUM_KEYWORDS = ['crack', 'pothole', 'partial', 'damage', 'debris', 'slow', 'minor flood', 'waterlogged'];

const TYPE_TO_CLASSIFICATION = {
  LANDSLIDE: 'LANDSLIDE',
  FLOOD: 'FLOOD',
  ROAD_DAMAGE: 'ROAD_DAMAGE',
  ACCIDENT: 'ACCIDENT',
  OTHER: 'UNCLASSIFIED_HAZARD',
};

/**
 * Deterministic local fallback. Never throws, never needs network access —
 * this is what keeps the golden demo reliable if an external AI API is
 * unavailable, unconfigured, or slow. Explicitly labeled DEMO_FALLBACK —
 * never presented as real AI inference.
 */
function analyzeWithFallback({ type, description = '' }) {
  const text = (description || '').toLowerCase();
  const classification = TYPE_TO_CLASSIFICATION[type] || 'UNCLASSIFIED_HAZARD';

  let severity = 'MEDIUM';
  let confidence = 0.78;
  let rationale;

  const matchedHigh = HIGH_KEYWORDS.filter((kw) => text.includes(kw));
  const matchedMedium = MEDIUM_KEYWORDS.filter((kw) => text.includes(kw));

  if (matchedHigh.length > 0) {
    severity = 'HIGH';
    confidence = 0.9 + Math.min(0.08, matchedHigh.length * 0.02);
    rationale = `Keyword match found high-severity term(s) in the description: ${matchedHigh.join(', ')}.`;
  } else if (matchedMedium.length > 0) {
    severity = 'MEDIUM';
    confidence = 0.82;
    rationale = `Keyword match found moderate-severity term(s) in the description: ${matchedMedium.join(', ')}.`;
  } else if (text.trim().length === 0) {
    // No description supplied — fall back on incident type alone, lower confidence.
    severity = type === 'LANDSLIDE' || type === 'FLOOD' ? 'HIGH' : 'MEDIUM';
    confidence = 0.6;
    rationale = 'No description was provided — severity inferred from incident type alone, with reduced confidence.';
  } else {
    severity = 'LOW';
    confidence = 0.7;
    rationale = 'No high- or moderate-severity keywords found in the description.';
  }

  confidence = Math.round(Math.min(confidence, 0.97) * 100) / 100;

  const summary = description && description.trim().length > 0
    ? `${classification.replace('_', ' ')} reported: ${description.trim().slice(0, 140)}`
    : `${classification.replace('_', ' ')} reported near driver location. No further description provided.`;

  return {
    classification,
    severity,
    confidence,
    summary,
    rationale,
    model: 'heuristic-keyword-v1',
    generatedAt: new Date(),
    source: 'DEMO_FALLBACK',
  };
}

/**
 * Timeout + no-retry fetch wrapper (a single incident-analysis call is
 * latency-sensitive to the driver-facing request; unlike the weather/SACHET
 * background ingestion adapters, this is not worth retrying inline — a
 * failure here falls straight through to the deterministic fallback).
 * `fetchFn` is injectable so tests exercise the real request/validation
 * logic against fixtures, with zero network access.
 */
async function fetchWithTimeout(url, options, { fetchFn = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Validates a parsed AI response before it is ever trusted. Malformed,
 * incomplete, or out-of-range output is rejected outright (returns null,
 * which falls through to the deterministic fallback) rather than being
 * partially trusted or coerced into shape.
 */
function validateParsedAiResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (!parsed.classification || typeof parsed.classification !== 'string') return false;
  if (!VALID_SEVERITIES.includes(parsed.severity)) return false;
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return false;
  return true;
}

/**
 * Optional real-AI path. Only attempted if ANTHROPIC_API_KEY is present in
 * the environment. Wrapped so any failure (network, timeout, quota,
 * malformed response) silently falls through to the deterministic
 * fallback — the demo must never break because an external API misbehaves,
 * and driver incident reporting must never be blocked by it.
 */
async function analyzeWithRealAI({ type, description }, { fetchFn } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const prompt = `You are a road-incident triage assistant. Given the incident type "${type}" and driver description "${description || '(no description provided)'}", respond with ONLY a JSON object with keys: classification (string), severity (one of LOW, MEDIUM, HIGH), confidence (number 0-1), summary (short string), rationale (short string explaining the classification, based only on the given type/description). No preamble, no markdown. Do not invent facts (casualties, road closures, coordinates, authorities) not present in the input.`;

    const response = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      { fetchFn }
    );

    if (!response.ok) return null;
    const data = await response.json();
    const text = (data.content || []).find((b) => b.type === 'text')?.text;
    if (!text) return null;

    const cleaned = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (_err) {
      return null; // malformed JSON -> rejected, not guessed at
    }

    if (!validateParsedAiResponse(parsed)) return null;

    return {
      classification: parsed.classification,
      severity: parsed.severity,
      confidence: Math.round(Number(parsed.confidence) * 100) / 100,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : null,
      model: ANTHROPIC_MODEL,
      generatedAt: new Date(),
      source: 'REAL_AI',
    };
  } catch (_err) {
    // Network/timeout/parse failure -> fall through to deterministic fallback.
    return null;
  }
}

/**
 * Main entry point. Tries real AI first (only if configured), otherwise
 * uses the deterministic fallback. Always resolves — never rejects — so
 * incident creation never blocks or fails because of this call.
 */
async function analyzeIncident({ type, description }, { fetchFn } = {}) {
  const real = await analyzeWithRealAI({ type, description }, { fetchFn });
  if (real) return real;
  return analyzeWithFallback({ type, description });
}

module.exports = { analyzeIncident, analyzeWithFallback, analyzeWithRealAI, validateParsedAiResponse };
