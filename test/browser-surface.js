'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { startChrome, stopProcess, getFreePort, waitForTarget, connectCdp, evaluate, waitForExpression } = require('./browser-smoke');

async function main() {
  const outputArg = process.argv.indexOf('--output');
  const output = outputArg >= 0 ? path.resolve(process.argv[outputArg + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-surface-evidence-'));
  fs.mkdirSync(output, { recursive: true });
  const routes = new Map([
    ['/', ['text/html', path.join(__dirname, 'fixtures/surface.html')]],
    ['/surface.json', ['application/json', path.join(__dirname, 'fixtures/surface.json')]],
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
    await waitForExpression(cdp, 'document.documentElement.dataset.ready === "true"', 10000);
    const read = expression => evaluate(cdp, expression);
    const events = () => read('JSON.parse(document.querySelector("#events").textContent)');
    async function click(selector) {
      const box = await read(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const b = el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height}; })()`);
      assert.ok(box.w > 0 && box.h > 0, selector);
      await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    }
    await read(`(() => {
      const tones = ['success', 'warning', 'danger', 'primary', 'info', 'muted', 'default'];
      window.filledClicks = 0;
      window.filledSurface = window.createFweRuntime().ui.createSurface({ root: 'main', templates: { main: { type: 'row', children: [
        ...tones.map(tone => ({ type: 'button', id: 'filled-' + tone, text: tone, preset: 'filled', tone,
          attrs: { 'aria-pressed': tone === 'success' ? { $path: 'selected' } : false, disabled: tone === 'success' ? { $path: 'disabled' } : false }, on: { click: 'choose' } })),
        { type: 'button', id: 'ordinary-success', text: 'Ordinary', tone: 'success' }
      ] } } }, { data: { selected: false, disabled: false }, actions: { choose() { window.filledClicks++; } } });
      document.body.prepend(window.filledSurface.root);
    })()`);
    const style = selector => read(`(() => { const el = document.querySelector(${JSON.stringify(selector)}), s = getComputedStyle(el); return { background: s.backgroundColor, color: s.color, border: s.borderTopColor, filter: s.filter, outline: s.outlineWidth, offset: s.outlineOffset, shadow: s.boxShadow, cursor: s.cursor, disabled: el.disabled, focus: el.matches(':focus-visible') }; })()`);
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    for (const tone of ['success', 'warning', 'danger', 'primary', 'info', 'muted', 'default']) {
      const colors = await style('#filled-' + tone), a = luminance(colors.background), b = luminance(colors.color);
      assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, JSON.stringify({ tone, colors }));
      assert.equal(colors.border, colors.background); assert.notEqual(colors.background, 'rgb(255, 255, 255)');
    }
    assert.equal((await style('#filled-success')).background, 'rgb(35, 122, 69)');
    assert.equal((await style('#filled-warning')).background, 'rgb(241, 199, 91)');
    assert.equal((await style('#filled-danger')).background, 'rgb(185, 64, 64)');
    assert.equal((await style('#ordinary-success')).background, 'rgb(255, 255, 255)', 'existing tone only colors text');
    const hover = await read('(() => { const r = document.querySelector("#filled-success").getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()');
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hover });
    assert.equal((await style('#filled-success')).filter, 'brightness(0.94)');
    await key('Tab', 'Tab', 9); await read('document.querySelector("#filled-success").focus()');
    const focused = await style('#filled-success'); assert.equal(focused.focus, true); assert.equal(focused.outline, '3px'); assert.equal(focused.offset, '4px');
    await read('document.querySelector("#ordinary-success").focus(); window.filledSurface.update({ selected:true })');
    const selected = await style('#filled-success'); assert.notEqual(selected.shadow, 'none'); assert.equal(selected.outline, '2px');
    await click('#filled-success'); assert.equal(await read('window.filledClicks'), 1);
    await read('window.filledSurface.update({ disabled:true })');
    await click('#filled-success'); assert.equal(await read('window.filledClicks'), 1, 'native disabled button ignores real pointer input');
    const disabled = await style('#filled-success'); assert.equal(disabled.disabled, true); assert.equal(disabled.cursor, 'not-allowed'); assert.equal(disabled.filter, 'none'); assert.equal(disabled.shadow, 'none');
    await read('window.filledSurface.update({ disabled:false }); document.querySelector("#filled-warning").focus()');
    const filledCapture = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(output, 'filled-buttons.png'), Buffer.from(filledCapture.data, 'base64'));
    await read('window.filledSurface.dispose()');
    cases.push('filled buttons expose semantic backgrounds with 4.5:1 contrast, hover/focus/selection states and native disabled interaction; ordinary tone styling is unchanged');
    assert.equal(await read('document.querySelector("#secret").value'), '');
    assert.equal(await read('document.querySelector("#name").maxLength'), 20);
    assert.deepEqual(await read('[...document.querySelector("#quality").options].map(x=>x.value)'), ['auto', 'standard', 'hd']);
    assert.equal(await read('document.querySelector("#quality").value'), 'hd');
    assert.equal(await read('document.querySelector("#file").accept'), 'image/png');
    cases.push('native fields inherit model constraints and enums; temporary secrets start empty');
    await click('#name'); await key('a', 'KeyA', 65, 2); await cdp.call('Input.insertText', { text: 'Edited asset' });
    assert.equal(await read('document.activeElement === document.querySelector("#name")'), true);
    assert.equal(await read('document.querySelector("#name").value'), 'Edited asset');
    assert.equal(await read('document.querySelector("#submit").disabled'), true);
    assert.equal(await read('document.querySelector("#submit").textContent'), 'Working');
    assert.equal(await read('document.querySelector("#status").textContent'), 'Typing in place');
    await key('Tab', 'Tab', 9);
    assert.equal(await read('document.querySelector("#submit").disabled'), false);
    assert.equal(await read('document.querySelector("#submit").hasAttribute("title")'), false);
    assert.equal(await read('document.querySelector("#submit").getAttribute("aria-busy")'), 'false');
    assert.equal(await read('document.querySelector("#status").hidden'), true);
    cases.push('configured state updates retain focused input, change button/status and remove stale attributes');
    assert.deepEqual((await events()).at(-1), { path: 'name', value: 'Edited asset' });
    await click('#enabled'); assert.deepEqual((await events()).at(-1), { path: 'enabled', value: true });
    await click('#secret'); await cdp.call('Input.insertText', { text: 'temporary-secret' }); await key('Tab', 'Tab', 9);
    assert.equal((await events()).length, 2);
    await click('#submit'); assert.deepEqual((await events()).at(-1), { command: 'submit', name: 'Edited asset', quality: 'hd', secretPresent: true });
    assert.doesNotMatch(JSON.stringify(await events()), /temporary-secret|never-render-this-value/);
    cases.push('real keyboard, checkbox and native submit dispatch configured handlers without secret persistence');
    await click('#options'); assert.equal(await read('document.querySelector("#quality").value'), 'hd'); assert.equal(await read('document.querySelector("#quality").options.length'), 3);
    await click('#switch');
    assert.equal(await read('document.querySelector("#alternate .fwe-surface-columns").dataset.columns'), '3');
    assert.equal(await read('document.querySelector("#alternate h3").textContent'), 'Configuration changed');
    cases.push('alternate JSON template changes layout and content; option refresh preserves valid model values');
    await click('#alternateSecret'); await cdp.call('Input.insertText', { text: 'fragment-secret' });
    await click('#switch');
    await waitForExpression(cdp, 'window.retiredSecret?.value === ""', 10000);
    assert.equal(await read('window.surface.refs.alternateSecret === document.querySelector("#alternateSecret")'), true);
    cases.push('replaced fragments release temporary secrets and preserve the new instance refs');
    const capture = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(output, 'surface.png'), Buffer.from(capture.data, 'base64'));
    await click('#clear'); assert.equal(await read('document.querySelector("#fixture").children.length'), 0);
    cases.push('dispose detaches configured surface'); assert.deepEqual(errors, []);
    const report = { ok: true, cases, errors }; fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); process.stdout.write(`${JSON.stringify({ ...report, output }, null, 2)}\n`);
  } catch (error) {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ok: false, cases, errors, error: error.stack }, null, 2)); throw error;
  } finally {
    cdp?.close(); if (chrome) await stopProcess(chrome); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
