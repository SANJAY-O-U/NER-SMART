/**
 * Central error handler. Keeps all API error responses in the same JSON shape.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err.stack || err);

  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  res.status(status).json({ success: false, error: message });
}

function notFound(req, res) {
  res.status(404).json({ success: false, error: `Route not found: ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound };
