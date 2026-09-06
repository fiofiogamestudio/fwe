const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SERVER_INTEGRATION_CONTRACT, loadAppConfig, startServer } = require('../src/server');

test('programmatic requestGuard is awaited before static, CRUD and stop routes and fails closed', async (t) => {
  assert.equal(SERVER_INTEGRATION_CONTRACT.requestGuard, 'await-before-routing-v1');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-guard-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'value.json'), '{"value":1}');
  const appPath = path.join(root, 'app.json');
  fs.writeFileSync(appPath, JSON.stringify({ id: 'guard-test', domains: [{ id: 'value', kind: 'document', source: 'single-json:value.json' }] }));
  const app = loadAppConfig(appPath);
  assert.throws(() => startServer(app, '127.0.0.1', 0, { requestGuard: true }), /must be a function/);
  let mode = 'deny';
  const server = await startServer(app, '127.0.0.1', 0, { quiet: true, requestGuard: async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (mode === 'throw') throw Object.assign(new Error('Host policy rejected.'), { status: 403 });
    return mode === 'allow' ? true : undefined;
  } });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [method, route] of [['GET', '/'], ['GET', '/api/app'], ['PUT', '/api/domains/value/files/value.json'], ['POST', '/api/app/stop']]) {
    const response = await fetch(base + route, { method, headers: { 'X-FWE-App': 'guard-test' }, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 403); await response.text();
  }
  assert.equal(fs.readFileSync(path.join(root, 'value.json'), 'utf8'), '{"value":1}');
  mode = 'throw';
  assert.equal((await fetch(base + '/api/app')).status, 403);
  mode = 'allow';
  assert.equal((await fetch(base + '/api/app')).status, 200);
});
