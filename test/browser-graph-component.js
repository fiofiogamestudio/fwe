'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { startChrome, stopProcess, getFreePort, waitForTarget, connectCdp, evaluate, waitForExpression } = require('./browser-smoke');

// Isolated fixture; real mouse/keyboard input. Evaluation only reads the DOM.
async function main() {
  if (typeof WebSocket !== 'function') throw new Error('Browser graph tests require Node.js 22 or newer.');
  const outputArg = process.argv.indexOf('--output');
  const output = outputArg >= 0 ? path.resolve(process.argv[outputArg + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-graph-evidence-'));
  fs.mkdirSync(output, { recursive: true });
  const routes = new Map([
    ['/', ['text/html; charset=utf-8', path.join(__dirname, 'fixtures', 'graph-component.html')]],
    ['/runtime.js', ['text/javascript; charset=utf-8', path.join(__dirname, '..', 'public', 'runtime.js')]],
    ['/graph-component.js', ['text/javascript; charset=utf-8', path.join(__dirname, '..', 'public', 'graph-component.js')]]
  ]);
  const server = http.createServer((req, res) => {
    const resource = routes.get(req.url);
    if (!resource || req.method !== 'GET') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': resource[0], 'Cache-Control': 'no-store' }).end(fs.readFileSync(resource[1]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let chrome;
  let cdp;
  const errors = [];
  const cases = [];
  try {
    const debugPort = await getFreePort();
    chrome = startChrome(url, debugPort);
    const target = await waitForTarget(debugPort, url, 12000);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text));
    await cdp.call('Runtime.enable');
    await cdp.call('Page.enable');
    await waitForExpression(cdp, 'document.documentElement.dataset.ready === "true"', 10000);
    const read = expression => evaluate(cdp, expression);
    const selected = host => read(`document.querySelector(${JSON.stringify(`#${host} .is-selected`)})?.dataset.nodeId || null`);
    const events = () => read('JSON.parse(document.querySelector("#events").textContent)');
    const transform = () => read('document.querySelector("#dag .fg-world").style.transform');
    async function bounds(selector) {
      return read(`(() => { const matches = document.querySelectorAll(${JSON.stringify(selector)}); if (matches.length !== 1) throw new Error('Ambiguous or missing browser target'); const node = matches[0]; const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, text: node.getAttribute('aria-label') || node.textContent }; })()`);
    }
    async function click(selector) {
      const box = await bounds(selector);
      assert.ok(box.width > 0 && box.height > 0, `visible ${selector}`);
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    }
    async function key(key, code, windowsVirtualKeyCode) {
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(key === 'Enter' ? { text: '\r' } : {}) });
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    }
    async function screenshot(name) {
      const capture = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(capture.data, 'base64'));
    }
    assert.equal(await read('document.querySelectorAll(".fwe-graph-component").length'), 3);
    assert.equal(await read('document.querySelectorAll("#dag [data-node-id]").length'), 4);
    assert.equal(await read('document.querySelectorAll("#dag [data-edge-id]").length'), 4);
    assert.equal(await read('document.querySelector("#dag img")'), null);
    assert.match(await read('document.querySelector("#dag [data-node-id=c]").textContent'), /<img src=x/);
    assert.equal(await read('getComputedStyle(document.querySelector("#dag .fwe-graph-component")).backgroundColor'), 'rgb(238, 244, 255)');
    assert.equal(await read('document.querySelector("#empty .fg-empty").hidden'), false);
    assert.match(await read('document.querySelector("#relations .fg-status").textContent'), /cycle groups/);
    assert.doesNotMatch(await read('document.querySelector("#relations .fg-status").textContent'), /not a DAG/);
    cases.push('independent hosts, theme inheritance, empty state, cycle reporting and plain-text rendering');
    await click('#dag [data-node-id="b"]');
    assert.equal(await selected('dag'), 'b');
    assert.equal(await selected('relations'), null);
    assert.equal(await read('document.querySelector("#dag [data-node-id=a]").dataset.relation'), 'upstream');
    assert.equal(await read('document.querySelector("#dag [data-node-id=d]").dataset.relation'), 'downstream');
    assert.equal(await read('document.querySelector("#dag [data-node-id=c]").dataset.relation'), 'unrelated');
    assert.deepEqual(await events(), [{ graph: 'dag', id: 'b' }]);
    await key('ArrowRight', 'ArrowRight', 39);
    assert.equal(await selected('dag'), 'd');
    assert.equal(await read('document.activeElement.dataset.nodeId'), 'd');
    await key('Escape', 'Escape', 27);
    assert.equal(await selected('dag'), null);
    assert.deepEqual((await events()).at(-1), { graph: 'dag', id: null });
    await key('Enter', 'Enter', 13);
    assert.equal(await selected('dag'), 'd', 'native button keyboard activation');
    cases.push('real click, keyboard selection/clear, focus and ancestor/descendant highlighting');
    await click('#relations [data-node-id="b"]');
    assert.equal(await selected('relations'), 'b');
    assert.equal(await read('document.querySelector("#relations [data-node-id=a]").dataset.relation'), 'both');
    const count = (await events()).length;
    await click('#select');
    assert.equal(await selected('dag'), 'b');
    assert.equal((await events()).length, count);
    const initialTransform = await transform();
    await click('#dag [aria-label="Zoom in"]');
    const zoomed = await transform();
    assert.notEqual(zoomed, initialTransform);
    await click('#update');
    assert.equal(await transform(), zoomed);
    assert.equal(await selected('relations'), 'b');
    assert.equal((await events()).length, count);
    assert.equal(await read('document.querySelector("#immutable").textContent'), 'true');
    assert.match(await read('document.querySelector("#dag [data-node-id=b]").textContent'), /refreshed/);
    cases.push('silent API selection/update, unchanged frozen input and retained manual viewport');
    const box = await bounds('#dag .fg-viewport');
    const panStart = { x: box.x + 10, y: box.y + 10 };
    await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...panStart, button: 'left', clickCount: 1 });
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: panStart.x + 45, y: panStart.y + 25, button: 'left', buttons: 1 });
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: panStart.x + 45, y: panStart.y + 25, button: 'left', clickCount: 1 });
    assert.notEqual(await transform(), zoomed);
    assert.equal(await selected('dag'), 'b');
    assert.equal(await read('document.querySelector("#dag .fg-viewport").classList.contains("is-panning")'), false);
    await click('#dag [aria-label="Fit graph"]');
    await screenshot('graph-component');
    await click('#resize');
    await waitForExpression(cdp, 'document.querySelector("#dag .fg-viewport").clientWidth < 900', 5000);
    await waitForExpression(cdp, `document.querySelector("#dag .fg-world").style.transform !== ${JSON.stringify(initialTransform)}`, 5000);
    assert.equal((await bounds('#dag')).width, 850);
    cases.push('real zoom/pan/fit and resize observer');
    await click('#destroy');
    assert.equal(await read('document.querySelectorAll("#dag .fwe-graph-component").length'), 0);
    assert.equal(await selected('relations'), 'c');
    assert.equal(await read('document.querySelectorAll(".fwe-graph-component").length'), 2);
    assert.equal(errors.length, 0, errors.join('\n'));
    cases.push('idempotent disposal leaves sibling instances alive, no browser errors');
    const report = { ok: true, cases, errors, output };
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, cases, errors }, null, 2));
    throw error;
  } finally {
    cdp?.close();
    await stopProcess(chrome);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
