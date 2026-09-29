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
 *   REAL_AI       - the provider chosen by AI_PROVIDER (gemini | anthropic),
 *                   used only when that provider's key is set; with
 *                   AI_PROVIDER unset, Anthropic if ANTHROPIC_API_KEY is set
 *                   (pre-Phase-10.2 behavior). `model` records which one.
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

// Phase 10.2 — Gemini provider (raw HTTPS, same contract as Anthropic).
// Default model per Phase 10.1 review of Google's model/deprecation docs;
// overridable with GEMINI_MODEL without a code change.
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Headroom above the ~150-token JSON answer so model-internal reasoning
// tokens (where applicable) cannot truncate it; a truncated answer is
// rejected (finishReason !== 'STOP') and falls back anyway.
const GEMINI_MAX_OUTPUT_TOKENS = 1024;
// Phase 10.3.2/10.3.9 — Gemini-only timeout, kept well below the Flutter
// incident POST timeout (15s) so the driver app gets a response even when
// Gemini is slow; REQUEST_TIMEOUT_MS itself stays 8s for Anthropic.
// Thinking is pinned to "minimal" to keep triage latency low.
const GEMINI_REQUEST_TIMEOUT_MS = 10000;
const GEMINI_THINKING_LEVEL = 'minimal';
const SUPPORTED_PROVIDERS = ['gemini', 'anthropic', 'fallback'];

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
async function fetchWithTimeout(url, options, { fetchFn = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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

/** The single incident-triage prompt shared by every real-AI provider. */
function buildIncidentPrompt({ type, description }) {
  return `You are a road-incident triage assistant. Given the incident type "${type}" and driver description "${description || '(no description provided)'}", respond with ONLY a JSON object with keys: classification (string), severity (one of LOW, MEDIUM, HIGH), confidence (number 0-1), summary (short string), rationale (short string explaining the classification, based only on the given type/description). No preamble, no markdown. Do not invent facts (casualties, road closures, coordinates, authorities) not present in the input.`;
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
    const prompt = buildIncidentPrompt({ type, description });

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
 * Gemini's structured-output schema for the same five fields the shared
 * validator checks. The schema narrows what Gemini returns, but its output
 * is still passed through validateParsedAiResponse() before it is trusted.
 */
const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    classification: { type: 'STRING' },
    severity: { type: 'STRING', enum: VALID_SEVERITIES },
    confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
    summary: { type: 'STRING' },
    rationale: { type: 'STRING' },
  },
  required: ['classification', 'severity', 'confidence', 'summary', 'rationale'],
};

/**
 * Optional Gemini path (Phase 10.2). Only attempted when AI_PROVIDER=gemini
 * and GEMINI_API_KEY is present. The key travels ONLY in the
 * x-goog-api-key header — never in the URL, where request logs would keep
 * it. Any failure (401/403/429/5xx, timeout, network, empty or blocked
 * response, non-STOP finish, malformed JSON, invalid fields) returns null,
 * which falls through to the deterministic fallback.
 *
 * Phase 10.3.9: every such failure emits ONE sanitized warning (provider,
 * model, category, HTTP status when known) so a production fallback is
 * never silent. Never the key, headers, request body, incident text or
 * any part of the provider's response.
 */
const GEMINI_BLOCKED_FINISH_REASONS = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'];

function logGeminiFailure(model, category, status) {
  const shownModel = String(model).replace(/[^\w.-]/g, '').slice(0, 64);
  const shownStatus = Number.isInteger(status) ? ` status=${status}` : '';
  console.warn(`[AI] provider=gemini model=${shownModel} failure=${category}${shownStatus} — using DEMO_FALLBACK`);
}

async function analyzeWithGemini({ type, description }, { fetchFn } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = (process.env.GEMINI_MODEL || '').trim() || DEFAULT_GEMINI_MODEL;
  let status; // set once an HTTP response exists
  const fail = (category) => {
    logGeminiFailure(model, category, status);
    return null;
  };

  try {
    const response = await fetchWithTimeout(
      `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildIncidentPrompt({ type, description }) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
            maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
            thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL },
          },
        }),
      },
      { fetchFn, timeoutMs: GEMINI_REQUEST_TIMEOUT_MS }
    );

    status = response.status;
    if (!response.ok) return fail('http_error');
    const data = await response.json();
    if (data?.promptFeedback?.blockReason) return fail('blocked'); // prompt blocked by safety filters

    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
    if (!candidate) return fail('invalid_response');
    if (candidate.finishReason !== 'STOP') {
      // SAFETY / RECITATION / ... -> blocked; MAX_TOKENS / missing / other -> invalid_response
      return fail(GEMINI_BLOCKED_FINISH_REASONS.includes(candidate.finishReason) ? 'blocked' : 'invalid_response');
    }
    const text = candidate.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) return fail('invalid_response');

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (_err) {
      return fail('parse_error'); // malformed JSON -> rejected, not guessed at
    }

    if (!validateParsedAiResponse(parsed)) return fail('invalid_response');

    return {
      classification: parsed.classification,
      severity: parsed.severity,
      confidence: Math.round(Number(parsed.confidence) * 100) / 100,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : null,
      model,
      generatedAt: new Date(),
      source: 'REAL_AI',
    };
  } catch (err) {
    // Before a response: timeout (our abort) or network failure.
    // After a response: an unreadable (non-JSON) body.
    if (status !== undefined) return fail('invalid_response');
    return fail(err?.name === 'AbortError' ? 'timeout' : 'network_error');
  }
}

/**
 * Phase 10.2 provider selection (pure; exported for tests).
 *   AI_PROVIDER=gemini | anthropic | fallback (case-insensitive)
 *   unset/blank -> unchanged pre-10.2 behavior: 'anthropic' if
 *                  ANTHROPIC_API_KEY is set, otherwise 'fallback'
 *   unknown     -> 'fallback' (flagged so the caller can warn)
 */
function resolveAiProvider(env = process.env) {
  const raw = (env.AI_PROVIDER || '').trim().toLowerCase();
  if (!raw) return { provider: env.ANTHROPIC_API_KEY ? 'anthropic' : 'fallback', unknown: false };
  if (SUPPORTED_PROVIDERS.includes(raw)) return { provider: raw, unknown: false };
  return { provider: 'fallback', unknown: true };
}

/**
 * Main entry point. Tries the selected real-AI provider (only if
 * configured), otherwise uses the deterministic fallback. Always resolves —
 * never rejects — so incident creation never blocks or fails because of
 * this call.
 */
async function analyzeIncident({ type, description }, { fetchFn } = {}) {
  const { provider, unknown } = resolveAiProvider();
  if (unknown) {
    // The provider NAME only (sanitized, length-capped) — never any credential.
    const shown = String(process.env.AI_PROVIDER).replace(/[^\w.-]/g, '').slice(0, 32);
    console.warn(`[AI] unknown AI_PROVIDER "${shown}" — using DEMO_FALLBACK (supported: ${SUPPORTED_PROVIDERS.join(', ')})`);
  }

  let real = null;
  if (provider === 'gemini') real = await analyzeWithGemini({ type, description }, { fetchFn });
  else if (provider === 'anthropic') real = await analyzeWithRealAI({ type, description }, { fetchFn });
  if (real) return real;
  return analyzeWithFallback({ type, description });
}

module.exports = {
  analyzeIncident,
  analyzeWithFallback,
  analyzeWithRealAI,
  analyzeWithGemini,
  resolveAiProvider,
  validateParsedAiResponse,
  DEFAULT_GEMINI_MODEL,
  GEMINI_REQUEST_TIMEOUT_MS,
};
