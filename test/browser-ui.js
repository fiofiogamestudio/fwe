const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  startFwe, startChrome, stopProcess, getFreePort, waitForHttp, waitForTarget,
  connectCdp, evaluate, waitForExpression
} = require('./browser-smoke');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-browser-ui-'));
  const app = createFixture(root);
  const port = await getFreePort();
  const debugPort = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const report = { root, checks: [], failures: [], errors: [] };
  const server = startFwe(app, port);
  let chrome;
  let cdp;
  const check = async (name, action) => {
    try {
      const measurements = await action();
      report.checks.push({ name, measurements });
    } catch (error) {
      report.failures.push({ name, error: error.stack || String(error) });
    }
    if (cdp) {
      const shot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(root, `${name}.png`), Buffer.from(shot.data, 'base64'));
    }
  };
  try {
    await waitForHttp(`${url}/api/app`, 12000);
    chrome = startChrome('about:blank', debugPort);
    const target = await waitForTarget(debugPort, 'about:blank', 12000);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    cdp.on('Runtime.exceptionThrown', (event) => report.errors.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text));
    await cdp.call('Runtime.enable');
    await cdp.call('Page.enable');
    await cdp.call('Page.navigate', { url });
    await waitForExpression(cdp, 'window.fwe?.navigation.current().collectionId === "records" && document.querySelector(".collection-item")', 12000);
    await verifyFilteredCollections(cdp, check, url);
    await evaluate(cdp, 'window.fwe.navigation.navigate({ domainId: "tasks", collectionId: "tasks" }, { skipDirtyCheck: true })');
    await waitForExpression(cdp, 'document.querySelectorAll(".collection-item").length === 140', 12000);
    for (const width of [1440, 760, 354]) {
      await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate(cdp, 'window.fwe.navigation.navigate({ domainId: "tasks", collectionId: "tasks" })');
      await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await check(`collection-${width}`, async () => {
        const metrics = await evaluate(cdp, `(() => {
          const items = [...document.querySelectorAll('.collection-item')];
          const title = document.querySelector('#appTitle').getBoundingClientRect();
          return {
            count: items.length,
            titles: items.map(item => {
              const title = item.querySelector('.collection-item__title');
              return { height: title.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(title).lineHeight) };
            }),
            wrappingMetadata: items.filter(item => getComputedStyle(item.querySelector('.collection-item__meta')).whiteSpace !== 'nowrap').length,
            contextHeight: document.querySelector('#resourceContextBar').getBoundingClientRect().height,
            workspaceHeight: document.querySelector('main.workspace').getBoundingClientRect().height,
            editorHeight: document.querySelector('#editorPanel').getBoundingClientRect().height,
            noInspector: document.querySelector('main.workspace').classList.contains('workspace--no-inspector'),
            toolbarOverlap: [...document.querySelectorAll('.toolbar button')].some(button => {
              const rect = button.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && rect.left < title.right && rect.right > title.left
                && rect.top < title.bottom && rect.bottom > title.top;
            }),
            duplicateTitle: document.querySelector('#surfaceSelection').textContent.trim() === document.querySelector('#collectionTitle').textContent.trim()
          };
        })()`);
        assert.equal(metrics.count, 140);
        assert.equal(metrics.titles.filter(item => item.height < item.lineHeight - 0.5).length, 0, JSON.stringify(metrics));
        assert.equal(metrics.wrappingMetadata, 0);
        assert.ok(metrics.contextHeight <= 300, JSON.stringify(metrics));
        assert.ok(metrics.workspaceHeight >= 550, JSON.stringify(metrics));
        assert.equal(metrics.noInspector, true);
        assert.ok(Math.abs(metrics.editorHeight - metrics.workspaceHeight) <= 1, JSON.stringify(metrics));
        assert.equal(metrics.toolbarOverlap, false, JSON.stringify(metrics));
        assert.equal(metrics.duplicateTitle, false);
        return metrics;
      });
      await evaluate(cdp, `(() => {
        document.querySelector('#uiFilter')?.remove();
        const filter = window.fwe.ui.createMultiSelect({ id: 'uiFilter', placeholder: 'Category',
          items: Array.from({ length: 30 }, (_, i) => ({ value: String(i), label: 'Long category label ' + i, count: i })), selected: ['0'] });
        document.querySelector('#collectionFilters').hidden = false;
        document.querySelector('#collectionFilters').append(filter);
      })()`);
      await check(`dropdown-${width}`, async () => {
        const metrics = await evaluate(cdp, `(() => {
          const filter = document.querySelector('#uiFilter');
          const summary = filter.shadowRoot.querySelector('summary');
          const select = document.querySelector('.field select');
          const style = element => {
            const computed = getComputedStyle(element);
            return Object.fromEntries(['height', 'fontSize', 'fontFamily', 'lineHeight', 'borderTopWidth', 'borderTopColor', 'borderRadius', 'backgroundColor'].map(key => [key, computed[key]]));
          };
          const enabled = { native: style(select), multi: style(summary) };
          select.disabled = true;
          filter.disabled = true;
          const disabled = { native: style(select), multi: style(summary) };
          select.disabled = false;
          filter.disabled = false;
          filter.open = true;
          return { enabled, disabled };
        })()`);
        assert.deepEqual(metrics.enabled.native, metrics.enabled.multi, JSON.stringify(metrics));
        assert.deepEqual(metrics.disabled.native, metrics.disabled.multi, JSON.stringify(metrics));
        assert.notEqual(metrics.disabled.native.backgroundColor, metrics.enabled.native.backgroundColor);
        return metrics;
      });
      await check(`popup-${width}`, async () => {
        await evaluate(cdp, 'document.querySelector("#uiFilter").open = true');
        await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(resolve))');
        const metrics = await evaluate(cdp, `(() => {
          const filter = document.querySelector('#uiFilter');
          const menu = filter.shadowRoot.querySelector('.menu');
          const rect = menu.getBoundingClientRect();
          const clipped = [...menu.querySelectorAll('.actions button, input, .option-label, .option-count')].filter(part => {
            const r = part.getBoundingClientRect();
            return r.left < rect.left || r.right > rect.right;
          }).length;
          const hit = document.elementFromPoint(rect.left + 12, Math.min(rect.bottom - 12, rect.top + 20));
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
            overflow: menu.scrollWidth > menu.clientWidth + 1, clipped, hit: hit === filter };
        })()`);
        assert.ok(metrics.width > 0 && metrics.height > 0, JSON.stringify(metrics));
        assert.ok(metrics.left >= 0 && metrics.right <= width && metrics.top >= 0 && metrics.bottom <= 1000, JSON.stringify(metrics));
        assert.equal(metrics.overflow, false);
        assert.equal(metrics.clipped, 0);
        assert.equal(metrics.hit, true, 'popup is occluded by a clipping ancestor');
        return metrics;
      });
      await check(`popup-interaction-${width}`, async () => {
        const result = await evaluate(cdp, `(() => {
          const control = document.querySelector('#uiFilter');
          const root = control.shadowRoot;
          root.querySelector('input[value="1"]').click();
          const selected = control.value;
          root.querySelector('summary').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          const closed = !control.open;
          control.open = true;
          const second = window.fwe.ui.createMultiSelect({ items: [{ value: 'a', label: 'Other' }] });
          document.querySelector('#collectionFilters').append(second);
          second.open = true;
          return new Promise(resolve => setTimeout(() => {
            const exclusive = !control.open && second.open;
            second.remove();
            const clean = !document.querySelector('#collectionFilters').querySelector('fwe-multi-select:not(#uiFilter)');
            control.remove();
            resolve({ selected, closed, exclusive, clean });
          }, 50));
        })()`);
        assert.deepEqual(result, { selected: ['0', '1'], closed: true, exclusive: true, clean: true });
        return result;
      });
      await check(`grid-${width}`, async () => {
        await evaluate(cdp, 'document.querySelector("#collectionGridButton").click()');
        const metrics = await evaluate(cdp, `(() => {
          const cards = [...document.querySelectorAll('.collection-grid-card')];
          return {
            count: cards.length,
            duplicateTitles: cards.filter(card => [...card.querySelectorAll('.collection-grid-card__value')]
              .some(value => value.textContent === card.querySelector('.collection-grid-card__title').textContent)).length,
            missingColumns: cards.filter(card => card.querySelectorAll('.collection-grid-card__row').length !== 3).length,
            overflow: cards.filter(card => card.scrollWidth > card.clientWidth + 1).length
          };
        })()`);
        assert.deepEqual(metrics, { count: 140, duplicateTitles: 0, missingColumns: 0, overflow: 0 });
        await evaluate(cdp, 'document.querySelector("#collectionDetailButton").click()');
        await waitForExpression(cdp, 'document.querySelectorAll(".field select").length > 0', 5000);
        return metrics;
      });
      await evaluate(cdp, 'window.fwe.navigation.navigate({ domainId: "flow" })');
      await waitForExpression(cdp, 'document.querySelectorAll(".graph-node").length > 0', 12000);
      await check(`graph-${width}`, async () => {
        await evaluate(cdp, 'document.querySelector("#viewHudResetButton").click()');
        const metrics = await evaluate(cdp, `(() => {
          const button = document.querySelector('#viewHudResetButton');
          const r = button.getBoundingClientRect();
          const viewport = document.querySelector('#graphViewport').getBoundingClientRect();
          const nodes = [...document.querySelectorAll('.graph-node')];
          const clipped = nodes.filter(node => {
            const n = node.getBoundingClientRect();
            return n.left < Math.max(0, viewport.left) || n.right > Math.min(innerWidth, viewport.right)
              || n.top < Math.max(0, viewport.top) || n.bottom > Math.min(innerHeight, viewport.bottom);
          }).map(node => node.dataset.key);
          const occluded = nodes.filter(node => {
            const n = node.getBoundingClientRect();
            return !node.contains(document.elementFromPoint(n.left + n.width / 2, n.top + n.height / 2));
          }).map(node => node.dataset.key);
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, viewport: { left: viewport.left, right: viewport.right, top: viewport.top, bottom: viewport.bottom },
            count: nodes.length, clipped, occluded,
            hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === button };
        })()`);
        assert.ok(metrics.left >= 0 && metrics.right <= width && metrics.top >= 0 && metrics.bottom <= 1000, JSON.stringify(metrics));
        assert.ok(metrics.top >= metrics.viewport.top && metrics.bottom <= metrics.viewport.bottom, JSON.stringify(metrics));
        assert.equal(metrics.hit, true, JSON.stringify(metrics));
        assert.ok(metrics.count > 0);
        assert.deepEqual(metrics.clipped, [], JSON.stringify(metrics));
        assert.deepEqual(metrics.occluded, [], JSON.stringify(metrics));
        const scale = () => evaluate(cdp, 'new DOMMatrix(getComputedStyle(document.querySelector("#graphStage")).transform).a');
        const before = await scale();
        await cdp.call('Input.dispatchMouseEvent', { type: 'mouseWheel', deltaX: 0, deltaY: -100,
          x: (metrics.viewport.left + metrics.viewport.right) / 2, y: metrics.viewport.top + 12 });
        await waitForExpression(cdp, `new DOMMatrix(getComputedStyle(document.querySelector('#graphStage')).transform).a > ${before}`, 5000);
        const after = await scale();
        assert.ok(Math.abs(after - Math.min(1, before * 1.1)) < 0.00001, JSON.stringify({ before, after }));
        await evaluate(cdp, 'document.querySelector("#viewHudResetButton").click()');
        assert.ok(Math.abs(await scale() - before) < 0.00001);
        metrics.wheelZoom = { before, after };
        return metrics;
      });
    }
    await verifyInspectorEditing(cdp, check);
    assert.deepEqual(report.errors, []);
    assert.equal(report.failures.length, 0, JSON.stringify(report.failures));
  } finally {
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ root, checks: report.checks.length, failures: report.failures, errors: report.errors }, null, 2));
    if (cdp) {
      await cdp.call('Browser.close').catch(() => {});
      cdp.close();
    }
    await stopProcess(chrome);
    await stopProcess(server);
  }
}

function createFixture(root) {
  for (const folder of ['tasks', 'flows']) fs.mkdirSync(path.join(root, 'workspace', folder), { recursive: true });
  for (const domain of ['tasks', 'flow']) {
    fs.copyFileSync(path.join(__dirname, '../examples/domains', `${domain}.fwe`), path.join(root, `${domain}.fwe`));
  }
  fs.copyFileSync(path.join(__dirname, '../examples/workspace/flows/flow.json'), path.join(root, 'workspace/flows/flow.json'));
  fs.writeFileSync(path.join(root, 'workspace/tasks/tasks.json'), JSON.stringify({ tasks: Array.from({ length: 140 }, (_, index) => ({
    id: `long-technical-identifier-with-metadata-${index}`, name: `Task ${index}`, status: '\u8349\u7a3f', reward: 100, note: ''
  })) }));
  fs.writeFileSync(path.join(root, 'workspace/records.json'), JSON.stringify({
    records: ['excluded', 'starter', 'primary'].map(id => ({ id, name: id, owner: 'base', status: id })),
    owners: [{ id: 'base', name: 'Base' }],
    groups: ['excluded', 'starter', 'primary'].map(id => ({ id, name: id, members: [id], [id]: true }))
  }));
  fs.writeFileSync(path.join(root, 'records.fwe.json'), JSON.stringify({
    id: 'records', title: 'Records', kind: 'document', source: { type: 'single-json', path: 'records.json' },
    workbench: { collections: [{ id: 'records', path: 'records', title: 'name', columns: ['id', 'name', 'status'],
      defaultItem: { id: 'new-record', name: 'New record', owner: '', status: 'draft' },
      filters: [
        { id: 'owner', itemPath: 'owner', options: { path: 'owners', value: 'id', label: 'name' } },
        { id: 'pool', itemValue: 'id', options: { path: 'groups', value: 'id', label: 'name', members: 'members', defaultWhen: ['starter', 'primary'] } }
    ] }] }
  }));
  const fields = Array.from({ length: 16 }, (_, i) => ({ path: `field${i}`, label: `Field ${i}`, placeholder: `field${i}`, type: 'text' }));
  const inspectorDomains = ['inspector-document', 'inspector-extension', 'inspector-page'];
  for (const id of inspectorDomains) {
    fs.writeFileSync(path.join(root, 'workspace', `${id}.json`), JSON.stringify(Object.fromEntries(fields.map(field => [field.path, `Initial ${field.path}`]))));
    fs.writeFileSync(path.join(root, `${id}.fwe.json`), JSON.stringify({
      id, title: id, kind: 'document', model: { type: 'object' }, source: { type: 'single-json', path: `${id}.json` },
      views: [{ type: 'form', ...(id === 'inspector-extension' ? { view: 'inspector-preview' } : {}),
        ...(id === 'inspector-page' ? { presentation: 'page' } : {}), modes: ['form', 'json'] }],
      inspector: { forms: { meta: { groups: [{ title: 'Editable configuration', fields: fields.map(field =>
        id === 'inspector-extension' ? { ...field, form: 'inspector-input' } : field) }] } } }
    }));
  }
  fs.writeFileSync(path.join(root, 'inspector.client.js'), `
    window.fwe.registerView('inspector-preview', {
      validateView: () => [],
      render(ctx) {
        ctx.renderInspector();
        ctx.showView('document');
        ctx.hosts.documentTree.classList.remove('form-page');
        ctx.hosts.documentTree.textContent = 'Extension preview';
      }
    });
    window.fwe.registerForm('inspector-input', {
      validateField: () => [],
      render(ctx) {
        const input = document.createElement('input');
        input.placeholder = ctx.field.path;
        input.value = ctx.value;
        input.addEventListener('change', () => ctx.setValue(input.value));
        return input;
      }
    });
  `);
  const app = path.join(root, 'app.fwe.json');
  fs.writeFileSync(app, JSON.stringify({ id: 'ui-test', title: 'UI regression', workspace: './workspace',
    extensions: [{ client: './inspector.client.js' }],
    domains: ['./tasks.fwe', './flow.fwe', './records.fwe.json', ...inspectorDomains.map(id => `./${id}.fwe.json`)],
    navigation: { defaultWorkspace: 'edit', defaultSection: 'records', workspaces: [{ id: 'edit', label: 'Edit', sections: [
      { id: 'records', label: 'Records', domain: 'records', collection: 'records', hideFile: true },
      { id: 'tasks', label: 'Tasks', domain: 'tasks', collection: 'tasks', hideFile: true },
      { id: 'flow', label: 'Flow', domain: 'flow' },
      ...inspectorDomains.map(id => ({ id, label: id, domain: id, hideFile: true }))
    ] }] }
  }));
  return app;
}

async function verifyInspectorEditing(cdp, check) {
  for (const [width, height] of [[1440, 900], [760, 900], [760, 500], [354, 900]]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const domain of ['inspector-document', 'inspector-extension', 'inspector-page']) {
      await check(`${domain}-${width}x${height}`, async () => {
        await evaluate(cdp, `window.fwe.navigation.navigate({ domainId: ${JSON.stringify(domain)} }, { skipDirtyCheck: true })`);
        const host = domain === 'inspector-page' ? '#documentTree' : '#inspectorForm';
        await waitForExpression(cdp, `document.querySelector('${host} input[placeholder="field15"]')`, 5000);
        const layout = await evaluate(cdp, `(() => {
          const rect = selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
          };
          return { workspace: rect('main.workspace'), editor: rect('#editorPanel'), inspector: rect('.inspector'),
            noInspector: document.querySelector('main.workspace').classList.contains('workspace--no-inspector') };
        })()`);
        if (domain === 'inspector-page') {
          assert.equal(layout.noInspector, true);
          assert.equal(layout.inspector.height, 0);
          assert.ok(Math.abs(layout.editor.height - layout.workspace.height) <= 1, JSON.stringify(layout));
        } else {
          assert.equal(layout.noInspector, false);
          assert.ok(layout.editor.height >= 200 && layout.inspector.height >= 260, JSON.stringify(layout));
          if (width <= 960) assert.ok(layout.inspector.top >= layout.editor.bottom, JSON.stringify(layout));
          else assert.ok(layout.inspector.left >= layout.editor.right, JSON.stringify(layout));
        }
        const fields = [];
        for (const key of ['field0', 'field15']) {
          const selector = `${host} input[placeholder="${key}"]`;
          const before = await evaluate(cdp, 'JSON.stringify(window.fwe.resources.current().data)');
          const value = `Edited ${domain} ${key}`;
          const bounds = await editVisibleField(cdp, selector, value);
          await waitForExpression(cdp, `window.fwe.resources.current().data[${JSON.stringify(key)}] === ${JSON.stringify(value)}`, 5000);
          await evaluate(cdp, 'document.querySelector("#undoButton").click()');
          assert.equal(await evaluate(cdp, 'JSON.stringify(window.fwe.resources.current().data)'), before);
          fields.push({ key, ...bounds });
        }
        await evaluate(cdp, `document.querySelector('${host} input[placeholder="field0"]').scrollIntoView({ block: 'nearest' })`);
        return { layout, fields };
      });
    }
  }
}

async function editVisibleField(cdp, selector, value) {
  await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center', inline: 'nearest' })`);
  await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const bounds = await evaluate(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const r = input.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height,
      enabled: !input.disabled && !input.readOnly,
      inViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
      hit: [[r.left + 2, r.top + 2], [r.right - 2, r.bottom - 2], [r.left + r.width / 2, r.top + r.height / 2]]
        .every(([x, y]) => document.elementFromPoint(x, y) === input) };
  })()`);
  assert.ok(bounds.width >= 100 && bounds.height >= 32 && bounds.enabled && bounds.inViewport && bounds.hit, JSON.stringify(bounds));
  const point = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2, button: 'left', clickCount: 1 };
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
  assert.equal(await evaluate(cdp, `document.activeElement === document.querySelector(${JSON.stringify(selector)})`), true);
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: process.platform === 'darwin' ? 4 : 2 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await cdp.call('Input.insertText', { text: value });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  return bounds;
}

async function verifyFilteredCollections(cdp, check, url) {
  const snapshot = () => evaluate(cdp, `(() => {
    const data = window.fwe.resources.current().data;
    const current = window.fwe.navigation.current();
    return { selected: current.itemId, visible: [...document.querySelectorAll('.collection-item')].map(item => item.dataset.itemId),
      pool: document.querySelector('#collectionFilter_pool').value, data };
  })()`);
  const reset = async () => {
    await cdp.call('Page.navigate', { url });
    await waitForExpression(cdp, 'window.fwe?.navigation.current().collectionId === "records" && document.querySelector(".collection-item")', 12000);
  };
  await check('default-filter-selection', async () => {
    const result = await snapshot();
    assert.deepEqual(result.pool, ['starter', 'primary']);
    assert.deepEqual(result.visible, ['starter', 'primary']);
    assert.equal(result.selected, 'starter');
    return result;
  });
  await check('empty-filter-navigation', async () => {
    await evaluate(cdp, 'document.querySelector("#collectionFilter_pool").clear()');
    assert.equal(await evaluate(cdp, 'window.fwe.navigation.navigate({ domainId: "records", collectionId: "records" })'), true);
    const result = await snapshot();
    assert.deepEqual(result.pool, []);
    assert.deepEqual(result.visible, []);
    assert.equal(result.selected, '');
    return result;
  });
  await reset();
  await check('new-filtered-draft', async () => {
    const before = await snapshot();
    await evaluate(cdp, 'document.querySelector("#collectionSearch").value = "starter"; document.querySelector("#collectionSearch").dispatchEvent(new Event("input")); document.querySelector("#addButton").click()');
    const created = await snapshot();
    const draft = created.data.records.at(-1);
    assert.equal(created.data.records.length, 4);
    assert.equal(created.selected, draft.id);
    assert.ok(created.visible.includes(draft.id));
    assert.deepEqual(created.pool, before.pool);
    assert.deepEqual(created.data.groups, before.data.groups);
    await evaluate(cdp, `(() => {
      const input = [...document.querySelectorAll('.field input')].find(input => input.value === 'New record');
      if (!input || input.disabled) throw new Error('Draft name is not editable');
      input.value = 'Renamed draft'; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    assert.equal((await snapshot()).data.records.at(-1).name, 'Renamed draft');
    await evaluate(cdp, 'document.querySelector("#undoButton").click(); document.querySelector("#undoButton").click()');
    assert.equal((await snapshot()).data.records.length, 3);
    await evaluate(cdp, 'document.querySelector("#redoButton").click()');
    const restored = await snapshot();
    assert.equal(restored.selected, draft.id);
    assert.ok(restored.visible.includes(draft.id));
    await evaluate(cdp, 'document.querySelector("#collectionFilter_pool").clear()');
    assert.deepEqual((await snapshot()).visible, []);
    assert.equal(await evaluate(cdp, `window.fwe.navigation.navigate({ domainId: 'records', collectionId: 'records', itemId: ${JSON.stringify(draft.id)} })`), true);
    const revealed = await snapshot();
    assert.equal(revealed.selected, draft.id);
    assert.deepEqual(revealed.pool, []);
    assert.ok(revealed.visible.includes(draft.id));
    return { created, restored, revealed };
  });
  await reset();
  await check('explicit-filtered-deep-link', async () => {
    assert.equal(await evaluate(cdp, 'window.fwe.navigation.navigate({ domainId: "records", collectionId: "records", itemId: "excluded" })'), true);
    const result = await snapshot();
    assert.equal(result.selected, 'excluded');
    assert.deepEqual(result.pool, ['excluded', 'starter', 'primary']);
    assert.equal(result.visible.length, 3);
    return result;
  });
  for (const width of [1440, 760]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await check(`identity-title-grid-${width}`, async () => {
      await evaluate(cdp, 'document.querySelector("#collectionGridButton").click()');
      const result = await evaluate(cdp, `({
        count: document.querySelectorAll('.collection-grid-card').length,
        labels: [...document.querySelectorAll('.collection-grid-card__label')].map(label => label.textContent),
        overflow: [...document.querySelectorAll('.collection-grid-card')].filter(card => card.scrollWidth > card.clientWidth + 1).length
      })`);
      assert.deepEqual(result, { count: 3, labels: ['status', 'status', 'status'], overflow: 0 });
      return result;
    });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
