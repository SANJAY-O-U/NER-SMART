/**
 * Shared Validators (Phase 1 — Production Safety Hardening)
 * --------------------------------------------------------------
 * Small, dependency-free guard-clause helpers for the highest-risk
 * fields on write endpoints — deliberately NOT a schema-validation
 * framework (joi/zod), per the mission's "no huge validation framework
 * unless genuinely necessary" instruction. Enum checks read the LIVE
 * Mongoose schema (`Model.schema.path(field).enumValues`) rather than
 * duplicating enum lists here, so they can never drift from the actual
 * model.
 */

const mongoose = require('mongoose');

function isValidObjectId(value) {
  return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
}

function isValidLat(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLng(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

/** Reads a Mongoose schema path's declared enum values, or [] if the path has none. */
function enumValuesFor(Model, path) {
  const schemaPath = Model.schema.path(path);
  return (schemaPath && schemaPath.enumValues) || [];
}

/** Valid when the model's schema declares no enum for this path (nothing to restrict against), or the value is one of the declared options. */
function isValidEnumValue(Model, path, value) {
  const values = enumValuesFor(Model, path);
  return values.length === 0 || values.includes(value);
}

/**
 * Defeats MongoDB query-operator injection via Express's default `qs`
 * bracket-notation parsing (e.g. `?roadId[$ne]=x` parses to an object,
 * not a string). Returns the value only if it's a genuine string,
 * `undefined` otherwise — callers then treat it exactly like "not
 * provided" rather than passing an object into a Mongoose filter.
 */
function sanitizeStringParam(value) {
  return typeof value === 'string' ? value : undefined;
}

/** Express middleware factory: rejects a route param that isn't a valid ObjectId before it ever reaches a Mongoose query. */
function validateObjectIdParam(paramName) {
  return (req, res, next) => {
    if (!isValidObjectId(req.params[paramName])) {
      return res.status(400).json({ success: false, error: `${paramName} must be a valid id` });
    }
    return next();
  };
}

module.exports = {
  isValidObjectId,
  isValidLat,
  isValidLng,
  enumValuesFor,
  isValidEnumValue,
  sanitizeStringParam,
  validateObjectIdParam,
};
