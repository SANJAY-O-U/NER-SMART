/**
 * Central error handler. Keeps all API error responses in the same JSON shape.
 *
 * Phase 1 hardening: 5xx (server-fault) errors never leak `err.message`
 * (stack traces, Mongoose/MongoDB internals, filesystem paths) to the
 * client when NODE_ENV=production — the full detail still goes to
 * `console.error` for server-side debugging, exactly as before. 4xx
 * (client-fault, e.g. validation) messages are always returned as-is in
 * every environment, since those are meant to be read by the caller.
 * Standard Express/Node convention: unset NODE_ENV behaves as
 * 'development' (full detail visible), matching this app's existing
 * local-dev-only reality by default.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err.stack || err);

  const status = err.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';
  const message = status >= 500 && isProduction ? 'Internal server error' : err.message || 'Internal server error';

  res.status(status).json({ success: false, error: message });
}

function notFound(req, res) {
  res.status(404).json({ success: false, error: `Route not found: ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound };
