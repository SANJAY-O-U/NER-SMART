/**
 * Shared response helpers so every endpoint returns predictable JSON.
 */

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function failure(res, message, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

module.exports = { success, failure };
