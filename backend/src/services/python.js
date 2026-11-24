const { spawn } = require('child_process');
const { config } = require('../config');
const { AppError } = require('../errors');

/**
 * Bridge to the Python analytics engine (analytics/analytics_cli.py).
 * Sends a JSON payload on stdin and reads a JSON result from stdout.
 * Business logic (Node) and analytics (Python) stay separate, with no extra server to run.
 */
function runAnalytics(command, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonBin, ['-I', config.analyticsScript, command], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new AppError(504, 'Analytics engine timed out.'));
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new AppError(503, `Could not start Python analytics engine (${config.pythonBin}): ${e.message}`));
    });
    child.on('close', () => {
      clearTimeout(timer);
      let parsed;
      try {
        parsed = JSON.parse(out);
      } catch {
        return reject(new AppError(500, 'Analytics engine returned an invalid response.', err.slice(-800)));
      }
      if (parsed.error) return reject(new AppError(parsed.status || 422, parsed.error));
      resolve(parsed);
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

module.exports = { runAnalytics };
