const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

async function main() {
  if (typeof WebSocket !== 'function') {
    throw new Error('Browser smoke tests require Node.js 22 or newer.');
  }

  const args = parseArgs(process.argv.slice(2));
  const appPath = path.resolve(process.cwd(), args.app || 'examples/app.fwe.json');
  const port = args.port ? Number(args.port) : await getFreePort();
  const debugPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const outputDir = path.resolve(process.cwd(), args.output || path.join(os.tmpdir(), 'fwe-browser-smoke'));
  fs.mkdirSync(outputDir, { recursive: true });

  const server = startFwe(appPath, port);
  let chrome = null;
  try {
    await waitForHttp(`${baseUrl}/api/app`, 12000);
    const app = await fetchJson(`${baseUrl}/api/app`);
    chrome = startChrome(baseUrl, debugPort);
    const target = await waitForTarget(debugPort, baseUrl, 12000);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const errors = [];
    cdp.on('Runtime.exceptionThrown', (payload) => errors.push(
      payload?.exceptionDetails?.exception?.description
      || payload?.exceptionDetails?.text
      || 'Runtime exception'
    ));
    cdp.on('Log.entryAdded', (payload) => {
      if (payload?.entry?.level === 'error') {
        errors.push(`${payload.entry.text || 'Console error'}${payload.entry.url ? ` @ ${payload.entry.url}` : ''}`);
      }
    });
    await cdp.call('Runtime.enable');
    await cdp.call('Log.enable');
    await cdp.call('Page.enable');
    try {
      await waitForExpression(cdp, 'window.fwe && document.querySelector("#domainSelect")?.options.length > 0', 12000);
    } catch (error) {
      const details = errors.length ? `\n${errors.join('\n')}` : '';
      throw new Error(`${error.message}${details}`);
    }

    const results = [];
    for (const domain of app.domains) {
      await selectDomain(cdp, domain.id);
      const metrics = await evaluate(cdp, `(() => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };
        const overflow = [...document.querySelectorAll('.inspector, .inspector-group, .field, .collection-workbench, .sidepanel-workbench')]
          .filter(visible)
          .filter((element) => element.scrollWidth > element.clientWidth + 2)
          .map((element) => ({ className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
        const tabIssues = [...document.querySelectorAll('[role="tablist"]')]
          .filter(visible)
          .map((tabList, index) => {
            const tabs = [...tabList.querySelectorAll('[role="tab"]')]
              .filter((tab) => tab.closest('[role="tablist"]') === tabList && visible(tab));
            if (!tabs.length) return null;
            const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
            const tabbable = tabs.filter((tab) => tab.tabIndex === 0);
            return selected.length === 1 && tabbable.length === 1 && selected[0] === tabbable[0]
              ? null
              : { index, className: tabList.className, tabs: tabs.length, selected: selected.length, tabbable: tabbable.length };
          })
          .filter(Boolean);
        return {
          domain: document.querySelector('#domainSelect')?.value || '',
          file: document.querySelector('#fileSelect')?.value || '',
          title: document.querySelector('#surfaceTitle')?.textContent || '',
          graphNodes: document.querySelectorAll('.graph-node:not(.graph-node--pseudo)').length,
          workbenchItems: document.querySelectorAll('.collection-item, .sidepanel-list-item').length,
          previewNodes: document.querySelectorAll('.adventure-route-node').length,
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
          overflow,
          tabIssues,
          statusLive: document.querySelector('#statusText')?.getAttribute('aria-live') || ''
        };
      })()`);
      const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(outputDir, `${safeName(domain.id)}.png`), Buffer.from(screenshot.data, 'base64'));
      results.push(metrics);
    }

    const contentKinds = await inspectContentEditor(cdp, outputDir);

    const tabKeyboard = await evaluate(cdp, `(async () => {
      const form = document.querySelector('#inspectorFormModeButton');
      const json = document.querySelector('#inspectorJsonModeButton');
      if (!form || !json) return { tested: false };
      form.click();
      form.focus();
      form.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const afterRight = {
        selected: json.getAttribute('aria-selected'),
        focused: document.activeElement === json
      };
      json.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        tested: true,
        afterRight,
        afterHome: {
          selected: form.getAttribute('aria-selected'),
          focused: document.activeElement === form
        }
      };
    })()`);

    const graphDomain = app.domains.find((domain) => domain.kind === 'graph');
    let graphMutation = null;
    if (graphDomain) {
      await selectDomain(cdp, graphDomain.id);
      graphMutation = await evaluate(cdp, `(async () => {
        const count = () => document.querySelectorAll('.graph-node:not(.graph-node--pseudo)').length;
        const before = count();
        const add = document.querySelector('#addButton');
        if (!add || add.disabled) return { before, skipped: true };
        add.click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        const afterAdd = count();
        document.querySelector('#undoButton')?.click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { before, afterAdd, afterUndo: count(), skipped: false };
      })()`);
    }

    await cdp.close();
    const failures = [];
    results.forEach((result) => {
      if (result.domain !== app.domains.find((domain) => domain.id === result.domain)?.id) {
        failures.push(`Domain did not load: ${result.domain}`);
      }
      if (result.documentOverflow > 2) failures.push(`${result.domain}: document overflow ${result.documentOverflow}px`);
      if (result.overflow.length) failures.push(`${result.domain}: ${result.overflow.length} control overflow(s)`);
      if (result.tabIssues.length) failures.push(`${result.domain}: ${result.tabIssues.length} invalid tablist(s)`);
      if (result.statusLive !== 'polite') failures.push(`${result.domain}: status region is not announced politely.`);
    });
    if (tabKeyboard.tested && (
      tabKeyboard.afterRight.selected !== 'true'
      || !tabKeyboard.afterRight.focused
      || tabKeyboard.afterHome.selected !== 'true'
      || !tabKeyboard.afterHome.focused
    )) {
      failures.push(`Tab keyboard navigation failed: ${JSON.stringify(tabKeyboard)}`);
    }
    if (graphMutation && !graphMutation.skipped) {
      if (graphMutation.afterAdd !== graphMutation.before + 1) failures.push('Graph add did not create exactly one node.');
      if (graphMutation.afterUndo !== graphMutation.before) failures.push('Graph undo did not restore the node count.');
    }
    failures.push(...errors.map((error) => `Browser error: ${error}`));

    contentKinds.forEach((result) => {
      if (!result.items) failures.push(`ContentEditor ${result.kind}: empty browser list.`);
      if (!result.title) failures.push(`ContentEditor ${result.kind}: empty editor title.`);
      if (result.overflow.length) failures.push(`ContentEditor ${result.kind}: ${result.overflow.length} control overflow(s).`);
      if (result.kind === 'item' && result.codeMirror !== 1) {
        failures.push(`ContentEditor item: expected one CodeMirror instance, got ${result.codeMirror}.`);
      }
      if (result.kind === 'dice') {
        if (result.faceLayout?.faces !== 6) failures.push(`ContentEditor dice: expected six face cards, got ${result.faceLayout?.faces || 0}.`);
        if (result.faceLayout?.quickEditors !== 6) failures.push(`ContentEditor dice: expected six quick editors, got ${result.faceLayout?.quickEditors || 0}.`);
        if (Number(result.faceLayout?.maxCardHeight || 0) > 220) {
          failures.push(`ContentEditor dice: face card is too tall (${result.faceLayout.maxCardHeight}px).`);
        }
        if (result.narrowFaceOverflow?.length) {
          failures.push(`ContentEditor dice: ${result.narrowFaceOverflow.length} narrow-layout overflow(s).`);
        }
        if (Number(result.diceFilterLayout?.packOptions || 0) < 2) {
          failures.push('ContentEditor dice: character multi-select has fewer than two options.');
        }
        if (Number(result.diceFilterLayout?.poolOptions || 0) < 1) {
          failures.push('ContentEditor dice: dice-pool multi-select has no options.');
        }
        if (Number(result.diceFilterLayout?.legacyPoolGroups || 0) !== 0) {
          failures.push('ContentEditor dice: legacy grouped pool list is still visible.');
        }
        if (Number(result.diceFilterInteraction?.multiList || 0) <= Number(result.diceFilterInteraction?.initialList || 0)) {
          failures.push('ContentEditor dice: selecting another character did not expand the flat list.');
        }
        if (Number(result.diceFilterInteraction?.emptyPoolList ?? -1) !== 0) {
          failures.push('ContentEditor dice: clearing pool selections did not empty the list.');
        }
        if (result.diceFilterInteraction?.gridCards !== result.diceFilterInteraction?.restoredPoolList) {
          failures.push('ContentEditor dice: grid and flat list do not share the same filters.');
        }
        if (result.diceFilterInteraction?.finalList !== result.diceFilterInteraction?.initialList) {
          failures.push('ContentEditor dice: filter smoke test did not restore the initial character selection.');
        }
        if (result.diceFilterInteraction?.crossPackOpened !== true) {
          failures.push('ContentEditor dice: opening a die from another selected character did not switch content stacks.');
        }
      }
    });

    console.log(JSON.stringify({ app: app.id, url: baseUrl, outputDir, results, contentKinds, tabKeyboard, graphMutation, errors }, null, 2));
    if (failures.length) {
      throw new Error(failures.join('\n'));
    }
  } finally {
    await stopProcess(chrome);
    await stopProcess(server);
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--app') result.app = argv[++index];
    else if (value === '--port') result.port = argv[++index];
    else if (value === '--output') result.output = argv[++index];
  }
  return result;
}

function startFwe(appPath, port) {
  const bin = path.resolve(__dirname, '..', 'bin', 'fwe.js');
  return childProcess.spawn(process.execPath, [bin, '--app', appPath, '--host', '127.0.0.1', '--port', String(port)], {
    cwd: path.dirname(appPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

function startChrome(url, debugPort) {
  const chromePath = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-chrome-'));
  const child = childProcess.spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1000',
    url
  ], { stdio: 'ignore', windowsHide: true });
  child.profileDir = profile;
  return child;
}

function findChrome() {
  const candidates = process.platform === 'win32'
    ? [
      path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Google Chrome or Chromium was not found.');
  return found;
}

async function stopProcess(processHandle) {
  if (!processHandle) return;
  if (processHandle.exitCode === null) {
    try {
      processHandle.kill('SIGTERM');
    } catch {
      // Process already exited.
    }
    await Promise.race([
      new Promise((resolve) => processHandle.once('exit', resolve)),
      delay(1500)
    ]);
  }
  if (processHandle.profileDir) {
    try {
      fs.rmSync(processHandle.profileDir, { recursive: true, force: true });
    } catch {
      // Chrome can hold a profile file briefly after process exit.
    }
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status} ${url}`);
  return response.json();
}

async function waitForTarget(port, url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith(url));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // Chrome is still starting.
    }
    await delay(80);
  }
  throw new Error('Timed out waiting for the Chrome debugging target.');
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 1;
    socket.addEventListener('open', () => {
      resolve({
        call(method, params = {}) {
          return new Promise((resolveCall, rejectCall) => {
            const id = nextId++;
            pending.set(id, { resolve: resolveCall, reject: rejectCall });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        on(method, listener) {
          const list = listeners.get(method) || [];
          list.push(listener);
          listeners.set(method, list);
        },
        close() {
          socket.close();
        }
      });
    }, { once: true });
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data || '{}'));
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message || 'CDP call failed.'));
        else request.resolve(message.result || {});
        return;
      }
      (listeners.get(message.method) || []).forEach((listener) => listener(message.params || {}));
    });
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result?.value;
}

async function waitForExpression(cdp, expression, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for browser expression: ${expression}`);
}

async function selectDomain(cdp, domainId) {
  await evaluate(cdp, `(async () => {
    const select = document.querySelector('#domainSelect');
    if (!select) throw new Error('Domain selector is missing.');
    if (select.value !== ${JSON.stringify(domainId)}) {
      select.value = ${JSON.stringify(domainId)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const started = Date.now();
    while (Date.now() - started < 10000) {
      const file = document.querySelector('#fileSelect');
      const loading = document.querySelector('#statusText')?.textContent === '加载中';
      if (select.value === ${JSON.stringify(domainId)} && file && file.options.length > 0 && !loading) return true;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error('Domain load timed out: ${safeName(domainId)}');
  })()`);
  await delay(100);
}

async function inspectContentEditor(cdp, outputDir) {
  const kinds = await evaluate(cdp, `(() => {
    const root = document.querySelector('.content-editor-host')?.shadowRoot;
    return root ? [...root.querySelectorAll('[data-kind]')].map((button) => button.dataset.kind).filter(Boolean) : [];
  })()`);
  const results = [];
  for (const kind of [...new Set(kinds || [])]) {
    const result = await evaluate(cdp, `(async () => {
      const root = document.querySelector('.content-editor-host')?.shadowRoot;
      const button = root?.querySelector('[data-kind="${safeName(kind)}"]');
      if (!root || !button) return { kind: ${JSON.stringify(kind)}, items: 0, title: '', overflow: ['missing root or tab'] };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      root.querySelector('.browser-item')?.click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      const visible = (element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
      };
      const overflow = [...root.querySelectorAll('.field, .clean-panel, .browser-item, .editor__body')]
        .filter(visible)
        .filter((element) => element.scrollWidth > element.clientWidth + 2)
        .map((element) => {
          const children = [...element.querySelectorAll('*')]
            .map((child) => ({ className: child.className || child.tagName, scrollWidth: child.scrollWidth, clientWidth: child.clientWidth }))
            .sort((left, right) => (right.scrollWidth - right.clientWidth) - (left.scrollWidth - left.clientWidth));
          return {
            className: element.className,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            widestChild: children[0] || null
          };
        });
      let codeMirror = null;
      if (${JSON.stringify(kind)} === 'item') {
        const scriptMode = [...root.querySelectorAll('#modeTabs button')]
          .find((candidate) => candidate.textContent.trim() === '脚本');
        scriptMode?.click();
        await new Promise((resolve) => setTimeout(resolve, 180));
        codeMirror = root.querySelectorAll('.CodeMirror').length;
      }
      return {
        kind: ${JSON.stringify(kind)},
        items: root.querySelectorAll('.browser-item').length,
        title: root.querySelector('#editorTitle')?.textContent || '',
        status: root.querySelector('#statusText')?.textContent || '',
        codeMirror,
        faceLayout: ${JSON.stringify(kind)} === 'dice' ? (() => {
          const cards = [...root.querySelectorAll('.dice-face-card')];
          return {
            faces: cards.length,
            quickEditors: root.querySelectorAll('.dice-face-quick-fields').length,
            advancedEditors: root.querySelectorAll('.dice-face-advanced').length,
            listHeight: Math.round(root.querySelector('.dice-face-list')?.getBoundingClientRect().height || 0),
            maxCardHeight: Math.round(Math.max(0, ...cards.map((card) => card.getBoundingClientRect().height)))
          };
        })() : null,
        diceFilterLayout: ${JSON.stringify(kind)} === 'dice' ? (() => {
          const packFilter = root.querySelector('#dicePackFilter');
          const poolFilter = root.querySelector('#dicePoolFilter');
          return {
            packOptions: packFilter?.items?.length || 0,
            selectedPacks: packFilter?.value?.length || 0,
            poolOptions: poolFilter?.items?.length || 0,
            selectedPools: poolFilter?.value?.length || 0,
            legacyPoolGroups: root.querySelectorAll('.dice-pool-group').length
          };
        })() : null,
        overflow
      };
    })()`);
    const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(outputDir, `content-${safeName(kind)}.png`), Buffer.from(screenshot.data, 'base64'));
    if (kind === 'dice') {
      await evaluate(cdp, `(() => {
        const root = document.querySelector('.content-editor-host')?.shadowRoot;
        if (root?.querySelector('#dicePackFilter')) root.querySelector('#dicePackFilter').open = true;
      })()`);
      await delay(100);
      const filterScreenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(outputDir, 'content-dice-filters.png'), Buffer.from(filterScreenshot.data, 'base64'));
      await evaluate(cdp, `(() => {
        const root = document.querySelector('.content-editor-host')?.shadowRoot;
        if (root?.querySelector('#dicePackFilter')) root.querySelector('#dicePackFilter').open = false;
        if (root?.querySelector('#dicePoolFilter')) root.querySelector('#dicePoolFilter').open = true;
      })()`);
      await delay(100);
      const poolFilterScreenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(outputDir, 'content-dice-pool-filters.png'), Buffer.from(poolFilterScreenshot.data, 'base64'));
      result.diceFilterInteraction = await evaluate(cdp, `(async () => {
        const root = document.querySelector('.content-editor-host')?.shadowRoot;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const initialList = root?.querySelectorAll('.browser-item').length || 0;
        const packFilter = root?.querySelector('#dicePackFilter');
        const poolFilter = root?.querySelector('#dicePoolFilter');
        if (packFilter) packFilter.open = false;
        if (poolFilter) poolFilter.open = false;
        const selectedPacks = new Set(packFilter?.value || []);
        const added = (packFilter?.items || []).find((item) => !selectedPacks.has(item.value));
        if (!added) return { initialList, multiList: initialList, emptyPoolList: -1, restoredPoolList: initialList, gridCards: -1, finalList: initialList };
        const addedPackId = added.value;
        const addedInput = [...(packFilter.shadowRoot?.querySelectorAll('input[type="checkbox"]') || [])]
          .find((input) => input.value === addedPackId);
        if (!addedInput) return { initialList, multiList: initialList, emptyPoolList: -1, restoredPoolList: initialList, gridCards: -1, finalList: initialList };
        addedInput.click();
        await wait(120);
        const multiList = root.querySelectorAll('.browser-item').length;
        (poolFilter.shadowRoot?.querySelectorAll('.actions button') || [])[1]?.click();
        await wait(120);
        const emptyPoolList = root.querySelectorAll('.browser-item').length;
        (poolFilter.shadowRoot?.querySelectorAll('.actions button') || [])[0]?.click();
        await wait(120);
        const restoredPoolList = root.querySelectorAll('.browser-item').length;
        root.querySelector('#gridViewButton')?.click();
        await wait(160);
        const gridCards = root.querySelectorAll('.card-grid-card').length;
        return { initialList, addedPackId, multiList, emptyPoolList, restoredPoolList, gridCards };
      })()`);
      const gridScreenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(outputDir, 'content-dice-grid-multi.png'), Buffer.from(gridScreenshot.data, 'base64'));
      const addedPackId = result.diceFilterInteraction.addedPackId || '';
      result.diceFilterInteraction.finalList = await evaluate(cdp, `(async () => {
        const root = document.querySelector('.content-editor-host')?.shadowRoot;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const packFilter = root?.querySelector('#dicePackFilter');
        if (packFilter?.value?.includes(${JSON.stringify(addedPackId)})) {
          packFilter.setValue(
            packFilter.value.filter((value) => value !== ${JSON.stringify(addedPackId)}),
            { emit: true, source: 'browser-smoke' }
          );
        }
        await wait(140);
        root?.querySelector('#detailViewButton')?.click();
        await wait(140);
        return root?.querySelectorAll('.browser-item').length || 0;
      })()`);
      result.diceFilterInteraction.crossPackOpened = await evaluate(cdp, `(async () => {
        const root = document.querySelector('.content-editor-host')?.shadowRoot;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const initialActivePack = root?.querySelector('#packSelect')?.value || '';
        const targetPackId = ${JSON.stringify(addedPackId)};
        const packFilter = root?.querySelector('#dicePackFilter');
        if (packFilter && !packFilter.value.includes(targetPackId)) {
          packFilter.setValue([...packFilter.value, targetPackId], { emit: true, source: 'browser-smoke' });
        }
        await wait(160);
        const target = [...(root?.querySelectorAll('.browser-item') || [])]
          .find((item) => item.dataset.packId === targetPackId);
        const targetId = target?.dataset.itemId || '';
        target?.click();
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const activePack = root?.querySelector('#packSelect')?.value || '';
          const subtitle = root?.querySelector('#editorSubtitle')?.textContent || '';
          if (activePack === targetPackId && targetId && subtitle.includes(targetId)) break;
          await wait(80);
        }
        const opened = (root?.querySelector('#packSelect')?.value || '') === targetPackId
          && Boolean(targetId)
          && (root?.querySelector('#editorSubtitle')?.textContent || '').includes(targetId);
        const packSelect = root?.querySelector('#packSelect');
        if (packSelect && initialActivePack && packSelect.value !== initialActivePack) {
          packSelect.value = initialActivePack;
          packSelect.dispatchEvent(new Event('change', { bubbles: true }));
          const restoreDeadline = Date.now() + 5000;
          while (Date.now() < restoreDeadline
            && (root?.querySelector('#editorSubtitle')?.textContent || '').includes(targetId)) await wait(80);
          await wait(120);
        }
        if (packFilter?.value?.includes(targetPackId)) {
          packFilter.setValue(
            packFilter.value.filter((value) => value !== targetPackId),
            { emit: true, source: 'browser-smoke' }
          );
        }
        await wait(160);
        return opened;
      })()`);
      await evaluate(cdp, `(() => {
        const root = document.querySelector('.content-editor-host')?.shadowRoot;
        root?.querySelector('.clean-panel--dice-faces')?.scrollIntoView({ block: 'start' });
      })()`);
      await delay(100);
      const faceScreenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(outputDir, 'content-dice-faces.png'), Buffer.from(faceScreenshot.data, 'base64'));

      await cdp.call('Emulation.setDeviceMetricsOverride', {
        width: 1000,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false
      });
      await delay(100);
      await evaluate(cdp, `(() => {
        const root = document.querySelector('.content-editor-host')?.shadowRoot;
        root?.querySelector('.clean-panel--dice-faces')?.scrollIntoView({ block: 'start' });
      })()`);
      result.narrowFaceOverflow = await evaluate(cdp, `(() => {
        const root = document.querySelector('.content-editor-host')?.shadowRoot;
        if (!root) return ['missing root'];
        return [...root.querySelectorAll('.dice-face-card, .dice-face-quick-fields')]
          .filter((element) => element.getClientRects().length > 0)
          .filter((element) => element.scrollWidth > element.clientWidth + 2)
          .map((element) => ({
            className: element.className,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth
          }));
      })()`);
      const narrowScreenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(outputDir, 'content-dice-faces-narrow.png'), Buffer.from(narrowScreenshot.data, 'base64'));
      await cdp.call('Emulation.clearDeviceMetricsOverride');
    }
    results.push(result);
  }
  return results;
}

function safeName(value) {
  return String(value || 'domain').replace(/[^A-Za-z0-9_.-]+/g, '-');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
