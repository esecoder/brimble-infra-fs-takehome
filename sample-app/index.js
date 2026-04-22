// Minimal Node.js HTTP server — no dependencies, zero install time.
// Railpack auto-detects this as a Node.js project (package.json present)
// and builds it into a container image. The app reads the PORT env var
// which Railpack sets automatically.

const http = require('http');
const os = require('os');

const PORT = parseInt(process.env.PORT || '3000', 10);
const START_TIME = new Date().toISOString();

const server = http.createServer((req, res) => {
  const body = JSON.stringify(
    {
      message: 'Hello from Brimble! 🚀',
      path: req.url,
      hostname: os.hostname(),
      started_at: START_TIME,
      requested_at: new Date().toISOString(),
    },
    null,
    2,
  );

  // Respond with HTML for browser visits, JSON for everything else
  const acceptsHTML = (req.headers['accept'] || '').includes('text/html');

  if (acceptsHTML) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Hello from Brimble</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 40px; max-width: 480px; text-align: center; }
    h1 { font-size: 2rem; margin-bottom: 12px; }
    pre { background: #0a0c0f; border-radius: 6px; padding: 16px; text-align: left; font-size: 0.8rem; color: #3fb950; overflow: auto; }
    .badge { display: inline-block; background: rgba(63,185,80,0.1); color: #3fb950; border: 1px solid #3fb950; border-radius: 99px; padding: 2px 10px; font-size: 0.75rem; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 Hello from Brimble</h1>
    <div class="badge">RUNNING</div>
    <pre>${body}</pre>
  </div>
</body>
</html>`);
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  }
});

server.listen(PORT, () => {
  console.log(`[sample-app] Listening on port ${PORT}`);
  console.log(`[sample-app] Started at ${START_TIME}`);
});
