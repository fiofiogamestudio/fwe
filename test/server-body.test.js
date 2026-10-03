const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { SERVER_INTEGRATION_CONTRACT, loadAppConfig, startServer } = require('../src/server');
const MiB = 1024 * 1024;
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-body-'));
  for (const name of ['small', 'normal', 'large']) { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, 'value.json'), '{"text":"original"}'); }
  fs.writeFileSync(path.join(root, 'extension.js'), "module.exports=fwe=>fwe.registerApi('/api/body',async({readBody,sendJson})=>{sendJson(200,{text:await readBody({maxBytes:4})});return true;});");
  const appFile = path.join(root, 'app.json'), config = { id: 'body-test', workspace: root, extensions: ['./extension.js'],
    domains: [{ id: 'small', kind: 'document', source: 'folder-json:small', save: { maxBodyBytes: 64 } },
      { id: 'normal', kind: 'document', source: 'folder-json:normal' },
      { id: 'large', kind: 'document', source: 'folder-json:large', save: { maxBodyBytes: 10 * MiB } }] };
  fs.writeFileSync(appFile, JSON.stringify(config));
  const server = await startServer(loadAppConfig(appFile), '127.0.0.1', 0, { quiet: true });
  t.after(async () => { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, appFile, config, base: 'http://127.0.0.1:' + server.address().port };
}
function request(url, { method = 'PUT', length, chunks }) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { 'Content-Type': 'application/json', ...(length === undefined ? {} : { 'Content-Length': length }) } }, res => {
      const received = []; res.on('data', chunk => received.push(chunk));
      res.on('end', () => { resolve({ status: res.statusCode, text: Buffer.concat(received).toString('utf8') }); req.destroy(); });
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    if (length === undefined) req.end();
  });
}
test('body limit is a bounded trusted configuration and advertised capability', async t => {
  assert.equal(SERVER_INTEGRATION_CONTRACT.boundedRequestBody, 'bytes-v1');
  const { config, appFile } = await fixture(t);
  for (const maxBodyBytes of [0, -1, 1.5, '64', null, 64 * MiB + 1]) {
    config.domains[0].save.maxBodyBytes = maxBodyBytes;
    fs.writeFileSync(appFile, JSON.stringify(config));
    assert.throws(() => loadAppConfig(appFile), /positive integer.*64 MiB/);
  }
});
test('domain saves can exceed 8 MiB while the default limit remains 8 MiB', async t => {
  const { root, base } = await fixture(t);
  const data = { text: '汉'.repeat(3 * MiB) }, body = JSON.stringify({ data });
  assert.ok(Buffer.byteLength(body) > 8 * MiB);
  const rejected = await fetch(base + '/api/domains/normal/files/value.json', { method: 'PUT', body });
  assert.equal(rejected.status, 413); await rejected.text();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'normal/value.json'), 'utf8')), { text: 'original' });
  const accepted = await fetch(base + '/api/domains/large/files/value.json', { method: 'PUT', body });
  assert.equal(accepted.status, 200, await accepted.text());
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'large/value.json'), 'utf8')), data);
});
test('POST and PUT reject declared oversize early and streamed oversize by bytes', async t => {
  const { root, base } = await fixture(t);
  for (const [method, route] of [['POST', '/api/domains/small/files'], ['PUT', '/api/domains/small/files/value.json']]) {
    const declared = await request(base + route, { method, length: 65, chunks: ['{}'] });
    assert.equal(declared.status, 413, declared.text);
    const streamed = await request(base + route, { method, chunks: Array(6).fill(Buffer.from('汉字汉字')) });
    assert.equal(streamed.status, 413, streamed.text);
  }
  assert.deepEqual(fs.readdirSync(path.join(root, 'small')), ['value.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'small/value.json'), 'utf8')), { text: 'original' });
});
test('extension readBody uses the same configurable byte limit and full UTF-8 decoding', async t => {
  const { base } = await fixture(t);
  const response = await fetch(base + '/api/body', { method: 'POST', body: '猫!' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: '猫!' });
  const rejected = await fetch(base + '/api/body', { method: 'POST', body: '猫咪' });
  assert.equal(rejected.status, 413); await rejected.text();
});
test('aborted streams reject once and ignore subsequent bytes', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  const start = source.indexOf('function requestBodyLimit('), end = source.indexOf('\nfunction parseRequestJson(', start);
  const c = { BODY_LIMIT: 8 * MiB, Buffer }; vm.createContext(c); vm.runInContext(source.slice(start, end), c);
  for (const trigger of ['aborted', 'close', 'error']) {
    const req = new EventEmitter(); req.headers = {}; req.complete = false;
    const result = c.readBody(req, { maxBytes: 4 }); req.emit('data', Buffer.from('猫'));
    req.emit(trigger, new Error('socket closed')); req.emit('data', Buffer.alloc(100)); req.emit('end');
    await assert.rejects(result, trigger === 'error' ? /socket closed/ : error => error.status === 400);
  }
});
