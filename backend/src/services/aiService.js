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
 * Output shape (matches SIH26002 mission spec):
 * {
 *   classification: string,
 *   severity: 'LOW' | 'MEDIUM' | 'HIGH',
 *   confidence: number (0-1),
 *   summary: string,
 *   source: 'REAL_AI' | 'DEMO_FALLBACK'
 * }
 */

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
 * unavailable, unconfigured, or slow.
 */
function analyzeWithFallback({ type, description = '' }) {
  const text = (description || '').toLowerCase();
  const classification = TYPE_TO_CLASSIFICATION[type] || 'UNCLASSIFIED_HAZARD';

  let severity = 'MEDIUM';
  let confidence = 0.78;

  const hasHigh = HIGH_KEYWORDS.some((kw) => text.includes(kw));
  const hasMedium = MEDIUM_KEYWORDS.some((kw) => text.includes(kw));

  if (hasHigh) {
    severity = 'HIGH';
    confidence = 0.9 + Math.min(0.08, HIGH_KEYWORDS.filter((kw) => text.includes(kw)).length * 0.02);
  } else if (hasMedium) {
    severity = 'MEDIUM';
    confidence = 0.82;
  } else if (text.trim().length === 0) {
    // No description supplied — fall back on incident type alone, lower confidence.
    severity = type === 'LANDSLIDE' || type === 'FLOOD' ? 'HIGH' : 'MEDIUM';
    confidence = 0.6;
  } else {
    severity = 'LOW';
    confidence = 0.7;
  }

  confidence = Math.round(Math.min(confidence, 0.97) * 100) / 100;

  const summary = description && description.trim().length > 0
    ? `${classification.replace('_', ' ')} reported: ${description.trim().slice(0, 140)}`
    : `${classification.replace('_', ' ')} reported near driver location.`;

  return {
    classification,
    severity,
    confidence,
    summary,
    source: 'DEMO_FALLBACK',
  };
}

/**
 * Optional real-AI path. Only attempted if ANTHROPIC_API_KEY is present in
 * the environment. Wrapped so any failure (network, quota, malformed
 * response) silently falls through to the deterministic fallback — the
 * demo must never break because an external API misbehaves.
 */
async function analyzeWithRealAI({ type, description }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const prompt = `You are a road-incident triage assistant. Given the incident type "${type}" and driver description "${description || '(no description provided)'}", respond with ONLY a JSON object with keys: classification (string), severity (one of LOW, MEDIUM, HIGH), confidence (number 0-1), summary (short string). No preamble, no markdown.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const text = (data.content || []).find((b) => b.type === 'text')?.text;
    if (!text) return null;

    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.classification || !parsed.severity || parsed.confidence === undefined) return null;

    return {
      classification: parsed.classification,
      severity: parsed.severity,
      confidence: Math.round(Number(parsed.confidence) * 100) / 100,
      summary: parsed.summary || '',
      source: 'REAL_AI',
    };
  } catch (err) {
    // Network/parse failure -> fall through to deterministic fallback.
    return null;
  }
}

/**
 * Main entry point. Tries real AI first (only if configured), otherwise
 * uses the deterministic fallback. Always resolves — never rejects.
 */
async function analyzeIncident({ type, description }) {
  const real = await analyzeWithRealAI({ type, description });
  if (real) return real;
  return analyzeWithFallback({ type, description });
}

module.exports = { analyzeIncident, analyzeWithFallback };
