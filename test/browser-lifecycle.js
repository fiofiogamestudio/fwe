const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  startFwe, startChrome, stopProcess, getFreePort, waitForHttp, waitForTarget,
  connectCdp, evaluate, waitForExpression
} = require('./browser-smoke');

// Real browser + HTTP + filesystem. All writes belong to this test's temporary host.
async function main() {
  if (typeof WebSocket !== 'function') throw new Error('Browser lifecycle tests require Node.js 22 or newer.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-browser-lifecycle-'));
  const outputArg = process.argv.indexOf('--output');
  const output = outputArg >= 0 ? path.resolve(process.argv[outputArg + 1]) : path.join(root, 'evidence');
  fs.mkdirSync(output, { recursive: true });
  for (const directory of ['notes', 'other', 'settings']) fs.mkdirSync(path.join(root, 'workspace', directory), { recursive: true });
  const write = (relative, contents) => fs.writeFileSync(path.join(root, relative), contents, 'utf8');
  write('workspace/notes/a.txt', 'initial a');
  write('workspace/notes/b.txt', 'initial b');
  write('workspace/other/a.txt', 'other domain');
  write('workspace/settings/settings.json', '{"name":"original"}\n');
  write('notes.fwe', 'id notes\ntitle "Notes"\nsource "folder-text:notes"\nview text { language txt }\n');
  write('other.fwe', 'id other\ntitle "Other"\nsource "folder-text:other"\nview text { language txt }\n');
  write('settings.fwe', 'id settings\ntitle "Settings"\nsource "folder-json:settings"\ndata Settings { name: string }\nview form { modes [form, json] }\n');
  write('app.fwe.json', JSON.stringify({ id: 'lifecycle-test', title: 'Lifecycle test', workspace: './workspace',
    domains: ['./notes.fwe', './other.fwe', './settings.fwe'] }));
  const port = await getFreePort();
  const debugPort = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const server = startFwe(path.join(root, 'app.fwe.json'), port);
  let chrome;
  let cdp;
  const cases = [];
  const errors = [];
  const read = (relative) => fs.readFileSync(path.join(root, 'workspace', relative), 'utf8');
  try {
    await waitForHttp(`${url}/api/app`, 12000);
    chrome = startChrome(url, debugPort);
    const target = await waitForTarget(debugPort, url, 12000);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    cdp.on('Runtime.exceptionThrown', (event) => errors.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text));
    await cdp.call('Runtime.enable');
    await cdp.call('Page.enable');
    await waitForExpression(cdp, 'window.fwe?.resources.current()?.file?.revision', 10000);
    await evaluate(cdp, `window.confirm = () => true; window.__saves = {};`);

    async function navigate(domainId, fileName) {
      const result = await evaluate(cdp, `window.fwe.navigation.navigate(${JSON.stringify({ domainId, fileName })}, { skipDirtyCheck: true })`);
      assert.equal(result, true, `navigate ${domainId}/${fileName}`);
      await waitForExpression(cdp, `window.fwe.resources.current().file?.name === ${JSON.stringify(fileName)} && !document.querySelector('main').inert`, 10000);
    }
    async function edit(text) {
      await evaluate(cdp, `(() => { const input = document.querySelector('#textView'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    }
    async function snapshot() {
      return evaluate(cdp, `({ ...window.fwe.resources.current(), saveDisabled: document.querySelector('#saveButton').disabled, shown: document.querySelector('#textView').value })`);
    }
    async function beginSave(id) {
      await evaluate(cdp, `window.__saves[${JSON.stringify(id)}] = { done: false }; window.fwe.resources.saveCurrent().then(ok => { window.__saves[${JSON.stringify(id)}] = { done: true, ok }; }); 'started'`);
    }
    async function finishSave(id, expected = true) {
      await waitForExpression(cdp, `window.__saves[${JSON.stringify(id)}]?.done`, 10000);
      assert.equal(await evaluate(cdp, `window.__saves[${JSON.stringify(id)}].ok`), expected, `save ${id}`);
    }
    async function holdNextResponse(method = 'PUT', suffix = '') {
      await evaluate(cdp, `(() => {
        const original = window.fetch;
        const gate = { started: false, released: false };
        window.__saveGate = gate;
        window.fetch = async (input, options) => {
          if ((options?.method || 'GET') !== ${JSON.stringify(method)} || !String(input).endsWith(${JSON.stringify(suffix)}) || gate.started) return original(input, options);
          gate.started = true;
          const response = await original(input, options);
          gate.status = response.status;
          gate.payload = options?.body ? JSON.parse(options.body) : null;
          gate.received = true;
          await new Promise(resolve => { gate.release = resolve; });
          window.fetch = original;
          return response;
        };
      })()`);
    }
    async function releaseResponse() {
      await waitForExpression(cdp, 'window.__saveGate?.received', 10000);
      await evaluate(cdp, 'window.__saveGate.release(); true');
    }
    async function screenshot(name) {
      const capture = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(capture.data, 'base64'));
    }

    await navigate('notes', 'a.txt');
    await evaluate(cdp, `window.prompt = () => 'brand-new.txt'; document.querySelector('#resourceMoreButton').click(); document.querySelector('#newButton').click();`);
    let current = await snapshot();
    assert.equal(current.file.name, 'brand-new.txt');
    assert.equal(current.file.exists, false);
    assert.equal(current.dirty, true);
    await edit('new file contents');
    await beginSave('create');
    await finishSave('create');
    assert.equal(read('notes/brand-new.txt'), 'new file contents');
    await navigate('notes', 'a.txt');
    await navigate('notes', 'brand-new.txt');
    assert.equal((await snapshot()).shown, 'new file contents');
    await evaluate(cdp, `window.prompt = () => 'A.TXT'; document.querySelector('#newButton').click();`);
    assert.equal((await snapshot()).file.name, 'brand-new.txt');
    assert.equal(read('notes/a.txt'), 'initial a');
    cases.push('new file -> create-only save -> reopen; case-insensitive collision preserves existing file');

    await evaluate(cdp, `window.prompt = () => 'raced.txt'; document.querySelector('#newButton').click();`);
    await edit('local draft');
    write('workspace/notes/raced.txt', 'created externally');
    await beginSave('create-conflict');
    await finishSave('create-conflict', false);
    current = await snapshot();
    assert.equal(current.file.name, 'raced.txt');
    assert.equal(current.file.exists, false);
    assert.equal(current.dirty, true);
    assert.equal(current.shown, 'local draft');
    assert.equal(read('notes/raced.txt'), 'created externally');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll("#diagnostics .diagnostic").length > 0'), true);
    cases.push('a file created externally after New produces a visible create-only conflict without losing either draft');

    await navigate('notes', 'a.txt');
    await edit('first edit');
    await holdNextResponse();
    await beginSave('during-save');
    await waitForExpression(cdp, 'window.__saveGate?.received', 10000);
    await edit('second edit while saving');
    await releaseResponse();
    await finishSave('during-save');
    current = await snapshot();
    assert.equal(current.shown, 'second edit while saving');
    assert.equal(current.dirty, true);
    assert.equal(current.saveDisabled, false);
    assert.equal(read('notes/a.txt'), 'first edit');
    await screenshot('pending-edit-retained');
    await beginSave('second-edit');
    await finishSave('second-edit');
    assert.equal(read('notes/a.txt'), 'second edit while saving');
    assert.equal((await snapshot()).dirty, false);
    cases.push('edit while PUT response is pending remains dirty and can be saved using the new revision');

    await edit('queued first');
    await holdNextResponse();
    await beginSave('queued-first');
    await waitForExpression(cdp, 'window.__saveGate?.received', 10000);
    await edit('queued second');
    await beginSave('queued-second');
    await releaseResponse();
    await finishSave('queued-first');
    await finishSave('queued-second');
    assert.equal(read('notes/a.txt'), 'queued second');
    assert.equal((await snapshot()).dirty, false);
    cases.push('two same-resource saves are ordered and do not conflict with their own revisions');

    await edit('saved before switching');
    await holdNextResponse();
    await beginSave('switch-success');
    await waitForExpression(cdp, 'window.__saveGate?.received', 10000);
    await navigate('other', 'a.txt');
    await edit('other unsaved edit');
    const otherBefore = await snapshot();
    await releaseResponse();
    await finishSave('switch-success');
    current = await snapshot();
    assert.equal(current.domain.id, 'other');
    assert.deepEqual(current.file, otherBefore.file);
    assert.equal(current.shown, 'other unsaved edit');
    assert.equal(current.dirty, true);
    assert.equal(read('other/a.txt'), 'other domain');
    cases.push('late successful response cannot change another domain with the same filename');

    await navigate('notes', 'a.txt');
    write('workspace/notes/a.txt', 'external edit');
    await edit('conflicting editor draft');
    await holdNextResponse();
    await beginSave('conflict');
    await waitForExpression(cdp, 'window.__saveGate?.received', 10000);
    assert.equal(await evaluate(cdp, 'window.__saveGate.status'), 409);
    await navigate('notes', 'b.txt');
    await edit('b remains dirty');
    const beforeFailure = await snapshot();
    await releaseResponse();
    await finishSave('conflict', false);
    current = await snapshot();
    assert.deepEqual(current.file, beforeFailure.file);
    assert.equal(current.shown, 'b remains dirty');
    assert.equal(current.dirty, true);
    assert.equal(read('notes/a.txt'), 'external edit');
    cases.push('real HTTP 409 preserves external bytes and a late failure cannot contaminate the new editor');

    await navigate('notes', 'a.txt');
    await edit('return after save');
    await holdNextResponse();
    await beginSave('return');
    await waitForExpression(cdp, 'window.__saveGate?.received', 10000);
    await navigate('notes', 'b.txt');
    await evaluate(cdp, `window.__returnDone = false; window.fwe.navigation.navigate({ domainId: 'notes', fileName: 'a.txt' }, { skipDirtyCheck: true }).then(ok => { window.__returnDone = ok; }); 'started'`);
    await waitForExpression(cdp, `document.querySelector('main').inert`, 10000);
    assert.equal(await evaluate(cdp, 'window.fwe.resources.saveCurrent()'), false);
    await releaseResponse();
    await finishSave('return');
    await waitForExpression(cdp, 'window.__returnDone', 10000);
    current = await snapshot();
    assert.equal(current.file.name, 'a.txt');
    assert.equal(current.shown, 'return after save');
    assert.equal(current.dirty, false);
    await edit('after returning');
    await beginSave('after-return');
    await finishSave('after-return');
    assert.equal(read('notes/a.txt'), 'after returning');
    cases.push('leaving and returning waits for the pending write, then reads a usable latest revision');

    await holdNextResponse('GET', '/b.txt');
    await evaluate(cdp, `window.__slowDone = false; window.fwe.navigation.navigate({ domainId: 'notes', fileName: 'b.txt' }, { skipDirtyCheck: true }).then(ok => { window.__slowDone = { ok }; }); 'started'`);
    await waitForExpression(cdp, 'window.__saveGate?.received', 10000);
    await evaluate(cdp, `(() => { const select = document.querySelector('#fileSelect'); select.value = 'a.txt'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitForExpression(cdp, `!document.querySelector('main').inert && window.fwe.resources.current().file?.name === 'a.txt'`, 10000);
    await releaseResponse();
    await waitForExpression(cdp, 'window.__slowDone', 10000);
    assert.equal(await evaluate(cdp, 'window.__slowDone.ok'), false);
    assert.equal((await snapshot()).file.name, 'a.txt');
    assert.equal((await snapshot()).shown, 'after returning');
    cases.push('selecting the already loaded file cancels an intervening slow read instead of letting its late response win');

    await navigate('settings', 'settings.json');
    await evaluate(cdp, `(() => { const input = document.querySelector('#inspectorForm input'); if (!input) throw new Error('form input missing'); input.value = 'first form edit'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await holdNextResponse();
    await beginSave('form');
    await waitForExpression(cdp, 'window.__saveGate?.received', 10000);
    await evaluate(cdp, `(() => { const input = document.querySelector('#inspectorForm input'); window.__pendingControl = input; input.focus(); input.value = 'uncommitted next edit'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await releaseResponse();
    await finishSave('form');
    assert.equal(await evaluate(cdp, 'window.__pendingControl.isConnected && window.__pendingControl.value === "uncommitted next edit"'), true);
    assert.equal((await snapshot()).dirty, true);
    assert.equal(JSON.parse(read('settings/settings.json')).name, 'first form edit');
    await screenshot('pending-form-control-retained');
    await beginSave('form-next');
    await finishSave('form-next');
    assert.equal(JSON.parse(read('settings/settings.json')).name, 'uncommitted next edit');
    cases.push('a focused, not-yet-committed form input survives a save response and saves on the next request');

    await evaluate(cdp, `(() => { const input = document.querySelector('#inspectorForm input'); input.value = '18446744073709551615'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await beginSave('decimal-string');
    await finishSave('decimal-string');
    assert.equal(JSON.parse(read('settings/settings.json')).name, '18446744073709551615');
    await navigate('notes', 'a.txt');
    await navigate('settings', 'settings.json');
    assert.equal(await evaluate(cdp, `document.querySelector('#inspectorForm input').value`), '18446744073709551615');
    cases.push('ordinary string fields preserve large decimal integer strings without FW-specific editor coupling');

    assert.deepEqual(errors, []);
    const report = { ok: true, cases, browserErrors: errors, temporaryWorkspace: root, output };
    fs.writeFileSync(path.join(output, 'lifecycle-result.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (cdp) {
      const capture = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).catch(() => null);
      if (capture) fs.writeFileSync(path.join(output, 'failure.png'), Buffer.from(capture.data, 'base64'));
    }
    fs.writeFileSync(path.join(output, 'lifecycle-result.json'), `${JSON.stringify({ ok: false, cases, browserErrors: errors, error: error.stack, temporaryWorkspace: root }, null, 2)}\n`);
    throw error;
  } finally {
    cdp?.close();
    await stopProcess(chrome);
    await stopProcess(server);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
