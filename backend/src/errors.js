class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

// wrap async route handlers so rejections reach the error middleware
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function errorMiddleware(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ success: false, error: { message: err.message, details: err.details } });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, error: { message: 'File is too large.' } });
  }
  if (err && err.code === '23505') {
    return res.status(409).json({ success: false, error: { message: 'A record with these values already exists.' } });
  }
  if (err && err.code === '23503') {
    return res.status(409).json({ success: false, error: { message: 'Operation blocked by a related record.' } });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { message: 'Invalid JSON body.' } });
  }
  console.error('[error]', err);
  return res.status(500).json({ success: false, error: { message: 'Internal server error.' } });
}

module.exports = { AppError, ok, wrap, errorMiddleware };
