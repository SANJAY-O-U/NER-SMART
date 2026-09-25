const mongoose = require('mongoose');

/**
 * Connects to MongoDB using MONGO_URI from environment variables.
 * Exits the process on failure so issues surface immediately during the hackathon.
 */
async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and configure it.');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log(describeConnection(mongoose.connection));
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
}

/**
 * Phase 8B.1: "MongoDB connected: <host> / <database>" — read from the live
 * connection (the database the driver actually selected, including the
 * implicit `test` fallback), never from MONGO_URI, so no username,
 * password or query parameter can reach the log.
 */
function describeConnection(connection) {
  return `MongoDB connected: ${connection.host || 'unknown-host'} / ${connection.name || 'unknown-database'}`;
}

module.exports = connectDB;
module.exports.describeConnection = describeConnection;
