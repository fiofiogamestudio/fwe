'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { startChrome, stopProcess, getFreePort, waitForTarget, connectCdp, evaluate, waitForExpression } = require('./browser-smoke');

async function main() {
  const outputArg = process.argv.indexOf('--output');
  const output = outputArg >= 0 ? path.resolve(process.argv[outputArg + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-workspace-evidence-'));
  fs.mkdirSync(output, { recursive: true });
  const routes = new Map([
    ['/', ['text/html', path.join(__dirname, 'fixtures/surface-workspace.html')]],
    ['/surface-workspace.json', ['application/json', path.join(__dirname, 'fixtures/surface-workspace.json')]],
    ...['runtime.js', 'inspector.js', 'surface.js', 'styles.css'].map(file => [`/${file}`, [file.endsWith('.css') ? 'text/css' : 'text/javascript', path.join(__dirname, '../public', file)]])
  ]);
  const server = http.createServer((req, res) => {
    const route = routes.get(req.url);
    if (!route || req.method !== 'GET') return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': `${route[0]}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(fs.readFileSync(route[1]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let chrome; let cdp; const cases = []; const errors = [];
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const port = await getFreePort(); chrome = startChrome(url, port);
    const target = await waitForTarget(port, url, 12000); cdp = await connectCdp(target.webSocketDebuggerUrl);
    cdp.on('Runtime.exceptionThrown', value => errors.push(value.exceptionDetails?.exception?.description || value.exceptionDetails?.text));
    await cdp.call('Runtime.enable'); await cdp.call('Page.enable');
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitForExpression(cdp, 'document.documentElement?.dataset.ready === "true"', 10000);
    const read = expression => evaluate(cdp, expression);
    const bounds = selector => read(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom}; })()`);
    async function click(selector) {
      const box = await bounds(selector); assert.ok(box.width && box.height, selector);
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    }
    async function screenshot(name) { const result = await cdp.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(result.data, 'base64')); }
    const main = await bounds('#mainArea'), parameters = await bounds('#parameters');
    assert.ok(parameters.width >= 320 && parameters.width <= 360, JSON.stringify(parameters));
    assert.ok(main.width > parameters.width * 2, 'preview owns the remaining width');
    assert.equal(main.y, parameters.y); assert.ok(main.height > parameters.height, 'shorter parameter area is not stretched');
    const preview = await bounds('#preview'); assert.ok(preview.height >= 240 && preview.height <= 420, 'media preview fits the viewport height');
    assert.equal((await bounds('#resourceContextBar')).height, 0);
    assert.equal(await read('getComputedStyle(document.querySelector("#fields")).borderTopWidth'), '0px');
    assert.equal(await read('getComputedStyle(document.querySelector("#advanced")).borderLeftWidth'), '0px');
    assert.equal(await read('getComputedStyle(document.querySelector("#primary")).backgroundColor'), 'rgb(81, 110, 158)');
    assert.equal(await read('getComputedStyle(document.querySelector("#primary")).color'), 'rgb(255, 255, 255)');
    cases.push('wide workspace prioritizes preview with a 340px parameter area, flat groups and primary action contrast');
    await click('#advancedSummary'); assert.equal(await read('document.querySelector("#advanced").open'), false);
    await click('#poll'); assert.equal(await read('document.querySelector("#advanced").open'), false);
    cases.push('native advanced disclosure remains collapsed across unchanged status polling');
    await screenshot('wide');
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 740, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok((await bounds('#parameters')).y >= (await bounds('#mainArea')).bottom, 'a narrow host keeps full width preview and input');
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
    const smallMain = await bounds('#mainArea'), smallParameters = await bounds('#parameters');
    assert.ok(smallParameters.y >= smallMain.bottom, 'parameter area stacks below preview');
    assert.ok(Math.abs(smallParameters.width - smallMain.width) < 1, 'stacked sections both fill the available width');
    assert.ok((await bounds('#resourceContextBar')).height >= 44, 'narrow navigation remains available');
    assert.ok((await bounds('#resourceContextBar')).height < 100, 'narrow navigation occupies content height rather than inherited horizontal flex basis');
    assert.equal(await read('document.documentElement.scrollWidth > innerWidth'), false);
    const previewHeight = (await bounds('#preview')).height;
    assert.ok(previewHeight >= 240 && previewHeight <= 340, 'narrow preview fits the viewport without losing a usable canvas');
    cases.push('narrow workspace stacks naturally without horizontal overflow and retains managed navigation');
    await screenshot('narrow'); assert.deepEqual(errors, []);
    const report = { ok: true, cases, errors, output }; fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally { cdp?.close(); if (chrome) await stopProcess(chrome); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
