'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compileFweDsl } = require('../src/dsl');
const {
  startFwe, startChrome, stopProcess, getFreePort, waitForHttp, waitForTarget,
  connectCdp, evaluate, waitForExpression
} = require('./browser-smoke');

// All editable resources and the browser profile belong to this isolated fixture.
// Blueprint forms are generated internally, so its fixture extension appends one
// registered Form field to that builder. Production navigation/guards are untouched.
async function main() {
  if (typeof WebSocket !== 'function') throw new Error('Browser graph guard tests require Node.js 22 or newer.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-graph-form-guard-'));
  const outputArg = process.argv.indexOf('--output');
  const output = outputArg < 0 ? path.join(root, 'evidence') : path.resolve(process.argv[outputArg + 1]);
  fs.mkdirSync(output, { recursive: true });
  for (const domain of ['ordinary', 'blueprint']) fs.mkdirSync(path.join(root, 'workspace', domain), { recursive: true });
  const ordinary = compileFweDsl(`id ordinary
title "Ordinary graph guard"
source "folder-json:ordinary"
data Graph {
  id: string
  entry: ref<Node.id>
  nodes: Node[]
}
type Node {
  id: int @key
  text: string
  next?: ref<Node.id> @edge
  pos: Point @position
}
type Point {
  x: int
  y: int
}
view graph nodes {
  layout free grid 10
  entry entry
  modes [canvas, json]
  node {
    title "Node {id}"
    body text
  }
}
`, { file: 'ordinary.fwe' });
  ordinary.inspector = { forms: { graphNode: { groups: [{ fields: [{ path: 'guardDraft', label: false, form: 'graph-guard-probe' }] }] } } };
  const blueprint = compileFweDsl(`id blueprint
title "Blueprint graph guard"
source "folder-json:blueprint"
data Graph {
  id: string
  nodes: Node[] @nodes
  edges: Edge[]
}
type Node {
  id: int @key
  type: string
  pos: Point @position
  values: json @default({})
}
type Edge {
  id: string @key
  from: Endpoint
  to: Endpoint
}
type Endpoint {
  node: int
  port: string
}
type Point {
  x: int
  y: int
}
view blueprint nodes {
  layout free grid 10
  edges edges
  nodeType type
  values values
  modes [canvas, json]
  node Step {
    title "Step"
    in enter: exec @control
    out next: exec @control
  }
}
`, { file: 'blueprint.fwe' });
  const documents = {
    ordinary: { id: 'ordinary', entry: 1, nodes: [
      { id: 1, text: 'First node', next: 2, pos: { x: 8, y: 8 }, guardDraft: '' },
      { id: 2, text: 'Second node', pos: { x: 42, y: 8 }, guardDraft: '' }
    ] },
    blueprint: { id: 'blueprint', nodes: [
      { id: 1, type: 'Step', pos: { x: 8, y: 8 }, values: {}, guardDraft: '' },
      { id: 2, type: 'Step', pos: { x: 42, y: 8 }, values: {}, guardDraft: '' }
    ], edges: [{ id: 'first-second', from: { node: 1, port: 'next' }, to: { node: 2, port: 'enter' } }] }
  };
  const originals = new Map();
  for (const [domain, document] of Object.entries(documents)) {
    const file = path.join(root, 'workspace', domain, 'graph.json');
    const bytes = JSON.stringify(document, null, 2);
    fs.writeFileSync(file, bytes); originals.set(file, bytes);
  }
  fs.writeFileSync(path.join(root, 'guard-probe.js'), `(function () {
    const probe = window.graphGuardProbe = { busy: false, mounted: 0, records: [], calls: 0 };
    fwe.registerForm('graph-guard-probe', { render(ctx) {
      const record = { id: ++probe.mounted, node: ctx.target.id, disposed: 0 };
      probe.records.push(record);
      const element = document.createElement('div');
      element.dataset.guardMount = record.id;
      element.dataset.guardNode = ctx.target.id;
      const input = document.createElement('input');
      input.dataset.guardInput = '';
      input.value = ctx.value || '';
      input.addEventListener('input', () => ctx.setValue(input.value, { refresh: false }));
      element.append(input);
      return { element, canLeave() { probe.calls++; return !probe.busy; }, dispose() { record.disposed++; } };
    }});
    const build = window.buildBlueprintNodeInspectorForm;
    window.buildBlueprintNodeInspectorForm = function (context) {
      const form = build(context);
      form.groups.push({ fields: [{ path: 'guardDraft', label: false, form: 'graph-guard-probe' }] });
      return form;
    };
  }());`);
  fs.writeFileSync(path.join(root, 'app.fwe.json'), JSON.stringify({ id: 'graph-form-guard', title: 'Graph Form guard fixture',
    workspace: './workspace', extensions: [{ client: './guard-probe.js' }], domains: [ordinary, blueprint] }));

  const port = await getFreePort(), debugPort = await getFreePort(), url = `http://127.0.0.1:${port}`;
  const server = startFwe(path.join(root, 'app.fwe.json'), port);
  let chrome, cdp;
  const cases = [], errors = [];
  const read = expression => evaluate(cdp, expression);
  const wait = expression => waitForExpression(cdp, expression, 12000);
  const settled = () => read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const selector = key => `#graphNodes [data-key=${JSON.stringify(key)}]`;
  const snapshot = () => read(`(() => {
    const resource = fwe.resources.current();
    return { domain: resource.domain.id, selection: resource.selection, data: resource.data, dirty: resource.dirty,
      jsonDirty: state.jsonDirty, jsonDraft: state.jsonDraft, drag: Boolean(state.drag),
      undo: state.history.undo.length, redo: state.history.redo.length,
      mount: document.querySelector('[data-guard-mount]')?.dataset.guardMount,
      input: document.querySelector('[data-guard-input]')?.value,
      records: graphGuardProbe.records.map(record => ({ ...record })),
      view: { tx: state.view.tx, ty: state.view.ty, scale: state.view.scale },
      contextHidden: document.querySelector('#graphContextMenu').classList.contains('hidden') };
  })()`);
  async function point(key) {
    const value = await read(`(() => { const element = document.querySelector(${JSON.stringify(selector(key))});
      if (!element) throw new Error('Graph node not found'); const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + 20, width: box.width, height: box.height }; })()`);
    assert.ok(value.width > 0 && value.height > 0, 'node is visible'); return { x: value.x, y: value.y };
  }
  async function clickNode(key, button = 'left') {
    const at = await point(key);
    await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button, clickCount: 1 });
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button, clickCount: 1 });
    await settled();
  }
  async function blocked(label, operation, expected) {
    await operation(); await settled(); assert.deepEqual(await snapshot(), expected, label); cases.push(label);
  }
  async function screenshot(name) {
    const shot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  }
  try {
    await waitForHttp(url + '/api/app', 12000);
    chrome = startChrome(url, debugPort);
    const target = await waitForTarget(debugPort, url, 12000); cdp = await connectCdp(target.webSocketDebuggerUrl);
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text));
    await cdp.call('Runtime.enable'); await cdp.call('Page.enable');
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await wait('window.graphGuardProbe && fwe.resources.current()?.file?.revision');
    await read('window.confirm = () => true');
    for (const domain of ['ordinary', 'blueprint']) {
      await read('graphGuardProbe.busy = false');
      assert.equal(await read(`fwe.navigation.navigate(${JSON.stringify({ domainId: domain, fileName: 'graph.json' })}, { skipDirtyCheck: true })`), true);
      await wait(`fwe.resources.current()?.domain?.id === ${JSON.stringify(domain)} && document.querySelectorAll('#graphNodes [data-key]').length === 2 && !document.querySelector('main').inert`);
      assert.equal(await read('focusGraphNode("nodes:1")'), true); await settled();
      await wait(`document.querySelector('[data-guard-node="1"]')`);
      assert.equal(await read('document.querySelectorAll("#graphEdges .graph-edge-hit").length'), 1);
      await read(`(() => { const input = document.querySelector('[data-guard-input]'); input.value = ${JSON.stringify(domain + ' pending draft')};
        input.dispatchEvent(new Event('input', { bubbles: true })); graphGuardProbe.busy = true; })()`);
      await settled();
      const before = await snapshot();
      assert.equal(before.dirty, true); assert.equal(before.selection.key, 'nodes:1');
      assert.equal(before.records.filter(record => !record.disposed).length, 1);
      await blocked(domain + ': busy click on another node preserves draft, selection and mount', () => clickNode('nodes:2'), before);
      await blocked(domain + ': busy click on current node preserves the existing mount', () => clickNode('nodes:1'), before);
      for (const key of ['nodes:1', 'nodes:2']) {
        await blocked(domain + ': busy focusGraphNode(' + key + ') has no effects', async () => {
          assert.equal(await read(`focusGraphNode(${JSON.stringify(key)})`), false);
        }, before);
      }
      await blocked(domain + ': busy edge click preserves node form and draft', () => read(`document.querySelector('#graphEdges .graph-edge-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }))`), before);
      await blocked(domain + ': busy drag gesture cannot start a drag or modify positions', async () => {
        const at = await point('nodes:2');
        await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', clickCount: 1 });
        assert.equal(await read('Boolean(state.drag)'), false);
        await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x + 40, y: at.y + 30, button: 'left', buttons: 1 });
        await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x + 40, y: at.y + 30, button: 'left', clickCount: 1 });
      }, before);
      await blocked(domain + ': busy right click cannot change the selection or open its menu', () => clickNode('nodes:2', 'right'), before);
      await blocked(domain + ': busy blank viewport click cannot clear the selection or dispose the form', async () => {
        const at = await read(`(() => { const box = document.querySelector('#graphViewport').getBoundingClientRect();
          return { x: box.x + 12, y: box.bottom - 12 }; })()`);
        await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', clickCount: 1 });
        await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', clickCount: 1 });
      }, before);
      await screenshot(domain + '-busy-preserved');
      await read('graphGuardProbe.busy = false');
      await clickNode('nodes:2');
      await wait(`fwe.resources.current().selection.key === "nodes:2" && document.querySelector('[data-guard-node="2"]')`);
      await settled();
      const after = await snapshot();
      assert.equal(after.records.find(record => String(record.id) === before.mount).disposed, 1);
      assert.equal(after.records.filter(record => !record.disposed).length, 1);
      assert.equal(after.data.nodes[0].guardDraft, domain + ' pending draft');
      assert.notEqual(after.mount, before.mount);
      assert.equal(await read('focusGraphNode("nodes:1")'), true); await settled();
      assert.equal((await snapshot()).selection.key, 'nodes:1');
      cases.push(domain + ': clearing busy restores node click and focus, releases old form once and retains draft data');
      await screenshot(domain + '-selection-restored');
    }
    for (const [file, bytes] of originals) assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'unsaved fixture bytes remain unchanged');
    assert.deepEqual(errors, []);
    const report = { ok: true, cases, errors, temporaryWorkspace: root, output,
      fixtureBoundary: 'Blueprint builder appends one registered test Form; production navigation and guards are unmodified.' };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (cdp) await screenshot('failure').catch(() => {});
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ok: false, cases, errors, temporaryWorkspace: root, error: error.stack,
      snapshot: cdp ? await snapshot().catch(() => null) : null }, null, 2));
    throw error;
  } finally {
    cdp?.close(); await stopProcess(chrome); await stopProcess(server);
  }
}

main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
