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
      await waitForExpression(cdp, 'window.fwe && document.querySelector("#groupSelect")?.options.length > 0 && document.querySelector("#domainSelect")?.options.length > 0', 12000);
    } catch (error) {
      const details = errors.length ? `\n${errors.join('\n')}` : '';
      throw new Error(`${error.message}${details}`);
    }

    const domains = args.domain
      ? app.domains.filter((domain) => domain.id === args.domain)
      : app.domains;
    if (!domains.length) {
      throw new Error(`Unknown domain: ${args.domain}`);
    }

    const results = [];
    let goapActionCount = null;
    for (const domain of domains) {
      await selectDomain(cdp, domain.id, domain.group || '');
      const availableFiles = await domainFiles(cdp);
      const files = args.file
        ? availableFiles.filter((name) => name === args.file || name.endsWith(`/${args.file}`))
        : availableFiles;
      if (args.file && !files.length) {
        throw new Error(`Unknown file in ${domain.id}: ${args.file}`);
      }
      for (const file of files.length ? files : ['']) {
        if (file) await selectFile(cdp, file);
        if (domain.id === 'ai_tree') await selectReadableBehaviorNode(cdp);
        let collectionItemCount = null;
        if (args.collection) {
          collectionItemCount = await inspectWorkbenchCollection(cdp, args.collection);
          if (collectionItemCount < 0) {
            throw new Error(`Unknown workbench collection in ${domain.id}: ${args.collection}`);
          }
        }
        if (args.item && !await selectWorkbenchItem(cdp, args.item)) {
          throw new Error(`Unknown workbench item in ${domain.id}: ${args.item}`);
        }
        let expectedSelectorCount = null;
        if (args.expectSelector) {
          await waitForExpression(
            cdp,
            `[...document.querySelectorAll(${JSON.stringify(args.expectSelector)})]
              .some((element) => element.getClientRects().length > 0)`,
            12000
          );
          expectedSelectorCount = await evaluate(
            cdp,
            `[...document.querySelectorAll(${JSON.stringify(args.expectSelector)})]
              .filter((element) => element.getClientRects().length > 0).length`
          );
        }
        let undoMutation = null;
        if (args.mutationButton || args.mutationSelector) {
          if (!args.mutationButton || !args.mutationSelector) {
            throw new Error('--mutation-button and --mutation-selector must be used together.');
          }
          undoMutation = await inspectUndoableButtonMutation(
            cdp,
            args.mutationButton,
            args.mutationSelector
          );
          if (
            undoMutation.afterMutation <= undoMutation.before
            || undoMutation.afterUndo !== undoMutation.before
          ) {
            throw new Error(
              `Undoable mutation failed for ${args.mutationButton}: `
                + `${undoMutation.before} -> ${undoMutation.afterMutation} -> ${undoMutation.afterUndo}`
            );
          }
        }
        const metrics = await inspectDomain(cdp);
        metrics.collectionItemCount = collectionItemCount;
        metrics.expectedSelector = args.expectSelector || '';
        metrics.expectedSelectorCount = expectedSelectorCount;
        metrics.undoMutation = undoMutation;
        const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const suffix = file ? `-${safeName(file)}` : '-empty';
        fs.writeFileSync(path.join(outputDir, `${safeName(domain.id)}${suffix}.png`), Buffer.from(screenshot.data, 'base64'));
        results.push(metrics);
        if (domain.id === 'ai_plan') {
          goapActionCount = await inspectWorkbenchCollection(cdp, 'GOAP 动作');
        }
      }
    }

    const contentKinds = !args.domain || domains.some((domain) => domain.id === 'content')
      ? await inspectContentEditor(cdp, outputDir)
      : [];

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

    const graphDomain = domains.find((domain) => domain.kind === 'graph');
    let graphMutation = null;
    if (graphDomain) {
      await selectDomain(cdp, graphDomain.id, graphDomain.group || '');
      graphMutation = await evaluate(cdp, `(async () => {
        const count = () => document.querySelectorAll('.graph-node:not(.graph-node--pseudo)').length;
        const before = count();
        const add = document.querySelector('#addButton');
        if (!add || add.disabled || add.hidden) return { before, skipped: true };
        add.click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        const afterAdd = count();
        document.querySelector('#undoButton')?.click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { before, afterAdd, afterUndo: count(), skipped: false };
      })()`);
    }

    const behaviorTreeDomain = domains.find((domain) => (
      domain.graph?.blueprint && domain.graph?.profile === 'behavior-tree'
    ));
    let blueprintContextMutation = null;
    if (behaviorTreeDomain) {
      await selectDomain(cdp, behaviorTreeDomain.id, behaviorTreeDomain.group || '');
      const files = await domainFiles(cdp);
      const file = files.find((name) => name.endsWith('bot/fight.json')) || files[0];
      if (file) await selectFile(cdp, file);
      blueprintContextMutation = await inspectBlueprintContextMutation(cdp);
    }

    const stateMachineDomain = domains.find((domain) => domain.graph?.profile === 'state-machine');
    let stateMachineMutation = null;
    if (stateMachineDomain) {
      await selectDomain(cdp, stateMachineDomain.id, stateMachineDomain.group || '');
      const files = await domainFiles(cdp);
      const file = files.find((name) => name.endsWith('ranged.json')) || files[0];
      if (file) await selectFile(cdp, file);
      stateMachineMutation = await inspectStateMachineMutation(cdp);
    }

    await cdp.close();
    const failures = [];
    results.forEach((result) => {
      if (result.domain !== app.domains.find((domain) => domain.id === result.domain)?.id) {
        failures.push(`Domain did not load: ${result.domain}`);
      }
      const expectedDomain = app.domains.find((domain) => domain.id === result.domain);
      const expectedGroup = expectedDomain?.group || app.labels?.ungrouped || '其他';
      if (expectedGroup !== result.group) {
        failures.push(`${result.domain}: group selector drifted (${result.group}).`);
      }
      if (result.domain.startsWith('ai_') && result.file && !result.fileLabel.includes('（')) {
        failures.push(`${result.domain}: file alias is missing from the selector.`);
      }
      if (result.domain === 'ai_tree') {
        if (!result.behaviorGuide) failures.push(`ai_tree ${result.file}: reading guide is missing.`);
        if (!result.behaviorGuideText) failures.push(`ai_tree ${result.file}: tree description is missing.`);
        if (!result.behaviorInspectorHelp) failures.push(`ai_tree ${result.file}: selected node type help is missing.`);
        if (!result.behaviorNoteEditor) failures.push(`ai_tree ${result.file}: node note editor is missing.`);
        if (result.behaviorDescriptions !== result.graphNodes) {
          failures.push(`ai_tree ${result.file}: ${result.behaviorDescriptions}/${result.graphNodes} nodes have descriptions.`);
        }
      }
      if (result.domain === 'ai_state') {
        if (result.stateLabelNodeOverlaps) {
          failures.push(`ai_state ${result.file}: ${result.stateLabelNodeOverlaps} transition label(s) overlap a state card.`);
        }
        if (result.stateLabelOverlaps) {
          failures.push(`ai_state ${result.file}: ${result.stateLabelOverlaps} transition label pair(s) overlap.`);
        }
        if (result.stateEdgeNodeCrossings) {
          failures.push(`ai_state ${result.file}: ${result.stateEdgeNodeCrossings} transition path(s) cross a state card (${result.stateEdgeNodeCrossingDetails.join(', ')}).`);
        }
      }
      if (result.documentOverflow > 2) failures.push(`${result.domain}: document overflow ${result.documentOverflow}px`);
      if (result.overflow.length) failures.push(`${result.domain}: ${result.overflow.length} control overflow(s)`);
      if (result.diagnostics.length) failures.push(`${result.domain}: ${result.diagnostics.join(' | ')}`);
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
    if (blueprintContextMutation) {
      const required = ['blueprint-edit', 'blueprint-add-child', 'blueprint-move', 'blueprint-duplicate', 'blueprint-delete'];
      required.forEach((action) => {
        if (!blueprintContextMutation.actions.includes(action)) failures.push(`Blueprint context menu is missing ${action}.`);
      });
      if (blueprintContextMutation.afterAddNodes !== blueprintContextMutation.beforeNodes + 1) {
        failures.push('Blueprint context add did not create exactly one node.');
      }
      if (blueprintContextMutation.afterAddEdges !== blueprintContextMutation.beforeEdges + 1) {
        failures.push('Blueprint context add did not create exactly one edge.');
      }
      if (blueprintContextMutation.afterUndoNodes !== blueprintContextMutation.beforeNodes
        || blueprintContextMutation.afterUndoEdges !== blueprintContextMutation.beforeEdges) {
        failures.push('Blueprint context add was not fully undoable.');
      }
      if (blueprintContextMutation.afterMoveOrder === blueprintContextMutation.beforeMoveOrder
        || blueprintContextMutation.afterUndoMoveOrder !== blueprintContextMutation.beforeMoveOrder) {
        failures.push('Blueprint context move did not change and restore sibling priority.');
      }
      if (blueprintContextMutation.afterDuplicateNodes <= blueprintContextMutation.beforeNodes
        || blueprintContextMutation.afterDuplicateEdges <= blueprintContextMutation.beforeEdges
        || blueprintContextMutation.afterUndoDuplicateNodes !== blueprintContextMutation.beforeNodes
        || blueprintContextMutation.afterUndoDuplicateEdges !== blueprintContextMutation.beforeEdges) {
        failures.push('Blueprint context duplicate did not copy and restore the subtree.');
      }
      if (blueprintContextMutation.afterDeleteNodes >= blueprintContextMutation.beforeNodes
        || blueprintContextMutation.afterDeleteEdges >= blueprintContextMutation.beforeEdges
        || blueprintContextMutation.afterUndoDeleteNodes !== blueprintContextMutation.beforeNodes
        || blueprintContextMutation.afterUndoDeleteEdges !== blueprintContextMutation.beforeEdges) {
        failures.push('Blueprint context delete did not remove and restore the subtree.');
      }
    }
    if (stateMachineMutation) {
      const stateActions = ['state-edit', 'state-add-transition', 'state-delete'];
      stateActions.forEach((action) => {
        if (!stateMachineMutation.stateActions.includes(action)) failures.push(`State context menu is missing ${action}.`);
      });
      const edgeActions = ['state-edge-edit', 'state-edge-delete'];
      edgeActions.forEach((action) => {
        if (!stateMachineMutation.edgeActions.includes(action)) failures.push(`Transition context menu is missing ${action}.`);
      });
      const requiredFields = ['目标状态', '转换名称', '条件 ID', '触发时机', '优先级'];
      requiredFields.forEach((label) => {
        if (!stateMachineMutation.fields.some((field) => field.startsWith(label))) {
          failures.push(`Transition inspector is missing ${label}.`);
        }
      });
      if (!stateMachineMutation.title.startsWith('转换：')) failures.push('Transition inspector title is unclear.');
      if (!stateMachineMutation.afterEdit.includes('自动化测试')) failures.push('Transition label edit was not rendered.');
      if (stateMachineMutation.afterUndoEdit !== stateMachineMutation.beforeLabel) {
        failures.push('Transition label undo did not restore the original value.');
      }
      if (stateMachineMutation.afterAddEdges !== stateMachineMutation.beforeEdges + 1) {
        failures.push('State context add did not create exactly one transition.');
      }
      if (stateMachineMutation.afterUndoAddEdges !== stateMachineMutation.beforeEdges) {
        failures.push('State transition add was not fully undoable.');
      }
      if (stateMachineMutation.afterDeleteEdges !== stateMachineMutation.beforeDeleteEdges - 1) {
        failures.push('Transition context delete did not remove exactly one transition.');
      }
      if (stateMachineMutation.afterUndoDeleteEdges !== stateMachineMutation.beforeDeleteEdges) {
        failures.push('Transition delete was not fully undoable.');
      }
      if (!stateMachineMutation.initialAfterSet || stateMachineMutation.initialAfterSet === stateMachineMutation.initialBefore) {
        failures.push('State context set-initial did not update the initial state.');
      }
      if (stateMachineMutation.initialAfterUndo !== stateMachineMutation.initialBefore) {
        failures.push('State set-initial was not fully undoable.');
      }
    }
    if (domains.some((domain) => domain.id === 'ai_plan') && goapActionCount !== 4) {
      failures.push(`GOAP action editor expected 4 actions, got ${goapActionCount}.`);
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

    console.log(JSON.stringify({ app: app.id, url: baseUrl, outputDir, results, contentKinds, tabKeyboard, graphMutation, blueprintContextMutation, stateMachineMutation, goapActionCount, errors }, null, 2));
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
    else if (value === '--domain') result.domain = argv[++index];
    else if (value === '--file') result.file = argv[++index];
    else if (value === '--collection') result.collection = argv[++index];
    else if (value === '--item') result.item = argv[++index];
    else if (value === '--expect-selector') result.expectSelector = argv[++index];
    else if (value === '--mutation-button') result.mutationButton = argv[++index];
    else if (value === '--mutation-selector') result.mutationSelector = argv[++index];
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

async function selectDomain(cdp, domainId, group = '') {
  await evaluate(cdp, `(async () => {
    const groupSelect = document.querySelector('#groupSelect');
    const select = document.querySelector('#domainSelect');
    if (!groupSelect || !select) throw new Error('Group or domain selector is missing.');
    const targetGroup = ${JSON.stringify(group)};
    if (targetGroup && groupSelect.value !== targetGroup) {
      groupSelect.value = targetGroup;
      groupSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const groupStarted = Date.now();
      while (Date.now() - groupStarted < 10000) {
        const hasTarget = [...select.options].some((option) => option.value === ${JSON.stringify(domainId)});
        const loading = document.querySelector('#statusText')?.textContent === '加载中';
        if (groupSelect.value === targetGroup && hasTarget && !loading) break;
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    }
    if (![...select.options].some((option) => option.value === ${JSON.stringify(domainId)})) {
      throw new Error('Domain is missing from selected group: ${safeName(domainId)}');
    }
    if (select.value !== ${JSON.stringify(domainId)}) {
      select.value = ${JSON.stringify(domainId)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const started = Date.now();
    while (Date.now() - started < 10000) {
      const file = document.querySelector('#fileSelect');
      const loading = document.querySelector('#statusText')?.textContent === '加载中';
      if (select.value === ${JSON.stringify(domainId)} && file && !loading) return true;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error('Domain load timed out: ${safeName(domainId)}');
  })()`);
  await delay(100);
}

async function domainFiles(cdp) {
  return evaluate(cdp, `(() => [...(document.querySelector('#fileSelect')?.options || [])]
    .map((option) => option.value)
    .filter(Boolean))()`);
}

async function selectFile(cdp, fileName) {
  await evaluate(cdp, `(async () => {
    const select = document.querySelector('#fileSelect');
    if (!select) throw new Error('File selector is missing.');
    if (select.value !== ${JSON.stringify(fileName)}) {
      select.value = ${JSON.stringify(fileName)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const started = Date.now();
    while (Date.now() - started < 10000) {
      const loading = document.querySelector('#statusText')?.textContent === '加载中';
      if (select.value === ${JSON.stringify(fileName)} && !loading) return true;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error('File load timed out: ${safeName(fileName)}');
  })()`);
  await delay(100);
}

async function selectReadableBehaviorNode(cdp) {
  await evaluate(cdp, `(async () => {
    const annotated = document.querySelector('.behavior-tree-node__note')?.closest('.behavior-tree-node');
    const node = annotated || document.querySelector('.behavior-tree-node');
    node?.click();
    await new Promise((resolve) => setTimeout(resolve, 60));
  })()`);
}

async function inspectDomain(cdp) {
  return evaluate(cdp, `(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    };
    const overflow = [...document.querySelectorAll('.inspector, .inspector-group, .field, .collection-workbench, .sidepanel-workbench')]
      .filter(visible)
      .filter((element) => element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({ className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    const stateMachine = document.querySelector('#graphView')?.dataset.profile === 'state-machine';
    const stateNodes = stateMachine
      ? [...document.querySelectorAll('.graph-node--state-machine:not(.graph-node--pseudo)')].filter(visible)
      : [];
    const stateLabels = stateMachine
      ? [...document.querySelectorAll('.graph-edge__label-bg')].filter(visible)
      : [];
    const intersects = (left, right, inset = 0) => (
      left.left < right.right - inset
      && left.right > right.left + inset
      && left.top < right.bottom - inset
      && left.bottom > right.top + inset
    );
    const stateLabelNodeOverlaps = stateLabels.reduce((count, label) => {
      const rect = label.getBoundingClientRect();
      return count + (stateNodes.some((node) => intersects(rect, node.getBoundingClientRect(), 2)) ? 1 : 0);
    }, 0);
    let stateLabelOverlaps = 0;
    stateLabels.forEach((label, index) => {
      const rect = label.getBoundingClientRect();
      stateLabels.slice(index + 1).forEach((other) => {
        if (intersects(rect, other.getBoundingClientRect(), 1)) stateLabelOverlaps += 1;
      });
    });
    const stateEdgeNodeCrossingDetails = [];
    if (stateMachine) {
      [...document.querySelectorAll('.graph-edge:not(.graph-edge-hit)')].forEach((path, pathIndex) => {
        const length = path.getTotalLength();
        const matrix = path.getScreenCTM();
        if (!length || !matrix) return;
        Array.from({ length: 17 }, (_, index) => (index + 2) / 20).some((ratio) => {
          const point = path.getPointAtLength(length * ratio);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          const node = stateNodes.find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            return screen.x > rect.left + 3 && screen.x < rect.right - 3
              && screen.y > rect.top + 3 && screen.y < rect.bottom - 3;
          });
          if (node) {
            const rect = node.getBoundingClientRect();
            stateEdgeNodeCrossingDetails.push(
              String(pathIndex) + ':' + path.getAttribute('class') + ':' + node.dataset.key
                + '@' + ratio.toFixed(2) + ':' + Math.round(screen.x) + ',' + Math.round(screen.y)
                + ' in ' + Math.round(rect.left) + ',' + Math.round(rect.top)
                + ',' + Math.round(rect.right) + ',' + Math.round(rect.bottom)
            );
            return true;
          }
          return false;
        });
      });
    }
    const stateEdgeNodeCrossings = stateEdgeNodeCrossingDetails.length;
    return {
      group: document.querySelector('#groupSelect')?.value || '',
      domain: document.querySelector('#domainSelect')?.value || '',
      file: document.querySelector('#fileSelect')?.value || '',
      fileLabel: document.querySelector('#fileSelect')?.selectedOptions?.[0]?.textContent || '',
      title: document.querySelector('#surfaceTitle')?.textContent || '',
      graphNodes: [...document.querySelectorAll('.graph-node:not(.graph-node--pseudo)')].filter(visible).length,
      behaviorDescriptions: [...document.querySelectorAll('.behavior-tree-node__description')].filter(visible).length,
      behaviorGuide: visible(document.querySelector('#graphGuide')),
      behaviorGuideText: document.querySelector('#graphGuide .graph-guide__description')?.textContent.trim() || '',
      behaviorInspectorHelp: [...document.querySelectorAll('.inspector .field__hint')].find((element) => visible(element))?.textContent.trim() || '',
      behaviorNoteEditor: [...document.querySelectorAll('.inspector textarea')].some((element) => visible(element)),
      stateLabelNodeOverlaps,
      stateLabelOverlaps,
      stateEdgeNodeCrossings,
      stateEdgeNodeCrossingDetails,
      workbenchItems: [...document.querySelectorAll('.collection-item, .sidepanel-list-item')].filter(visible).length,
      previewNodes: [...document.querySelectorAll('.adventure-route-node')].filter(visible).length,
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      overflow,
      tabIssues: [...document.querySelectorAll('[role="tablist"]')]
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
        .filter(Boolean),
      statusLive: document.querySelector('#statusText')?.getAttribute('aria-live') || '',
      diagnostics: [...new Set(
        [...document.querySelectorAll('.diagnostic.error')]
          .filter(visible)
          .map((element) => element.textContent.trim())
          .filter(Boolean)
      )]
    };
  })()`);
}

async function inspectBlueprintContextMutation(cdp) {
  return evaluate(cdp, `(async () => {
    const countNodes = () => document.querySelectorAll('.behavior-tree-node').length;
    const countEdges = () => document.querySelectorAll('.blueprint-edge').length;
    const findNode = () => document.querySelector('[data-key="nodes:3"]')
      || document.querySelector('.behavior-tree-node--composite');
    const nodeOrder = () => Number(findNode()?.querySelector('.behavior-tree-node__order')?.textContent);
    const openMenu = async () => {
      const node = findNode();
      if (!node) throw new Error('Behavior-tree mutation probe could not find a composite node.');
      const rect = node.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.left + 8,
        clientY: rect.top + 8
      }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      return [...(document.querySelector('#graphContextMenu')?.querySelectorAll('button[data-action]') || [])];
    };
    const beforeNodes = countNodes();
    const beforeEdges = countEdges();
    let buttons = await openMenu();
    const actions = [...new Set(buttons.map((button) => button.dataset.action))];
    const add = buttons.find((button) => (
      button.dataset.action === 'blueprint-add-child' && button.dataset.nodeType === 'Succeed'
    )) || buttons.find((button) => button.dataset.action === 'blueprint-add-child');
    if (!add) throw new Error('Behavior-tree context menu has no compatible child action.');
    add.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterAddNodes = countNodes();
    const afterAddEdges = countEdges();
    document.querySelector('#undoButton')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const beforeMoveOrder = nodeOrder();
    buttons = await openMenu();
    const move = buttons.find((button) => (
      button.dataset.action === 'blueprint-move' && button.dataset.direction === '1'
    )) || buttons.find((button) => button.dataset.action === 'blueprint-move');
    if (!move) throw new Error('Behavior-tree context menu has no priority move action.');
    move.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterMoveOrder = nodeOrder();
    document.querySelector('#undoButton')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterUndoMoveOrder = nodeOrder();

    buttons = await openMenu();
    const duplicate = buttons.find((button) => button.dataset.action === 'blueprint-duplicate');
    if (!duplicate) throw new Error('Behavior-tree context menu has no subtree duplicate action.');
    duplicate.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterDuplicateNodes = countNodes();
    const afterDuplicateEdges = countEdges();
    document.querySelector('#undoButton')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterUndoDuplicateNodes = countNodes();
    const afterUndoDuplicateEdges = countEdges();

    buttons = await openMenu();
    const remove = buttons.find((button) => button.dataset.action === 'blueprint-delete');
    if (!remove) throw new Error('Behavior-tree context menu has no subtree delete action.');
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    remove.click();
    window.confirm = originalConfirm;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterDeleteNodes = countNodes();
    const afterDeleteEdges = countEdges();
    document.querySelector('#undoButton')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      actions,
      beforeNodes,
      beforeEdges,
      afterAddNodes,
      afterAddEdges,
      afterUndoNodes: countNodes(),
      afterUndoEdges: countEdges(),
      beforeMoveOrder,
      afterMoveOrder,
      afterUndoMoveOrder,
      afterDuplicateNodes,
      afterDuplicateEdges,
      afterUndoDuplicateNodes,
      afterUndoDuplicateEdges,
      afterDeleteNodes,
      afterDeleteEdges,
      afterUndoDeleteNodes: countNodes(),
      afterUndoDeleteEdges: countEdges()
    };
  })()`);
}

async function inspectStateMachineMutation(cdp) {
  return evaluate(cdp, `(async () => {
    const wait = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
    const edgeCount = () => document.querySelectorAll('.graph-edge-hit').length;
    const firstTransitionLabel = () => document.querySelector('.graph-edge__label-bg--forward')
      || document.querySelector('.graph-edge__label-bg--return')
      || document.querySelector('.graph-edge__label-bg');
    const click = (element) => {
      if (!element) throw new Error('State-machine probe could not find a transition label.');
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      }));
    };
    const openContext = async (element) => {
      if (!element) throw new Error('State-machine probe could not find a context target.');
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.left + Math.max(4, rect.width / 2),
        clientY: rect.top + Math.max(4, rect.height / 2)
      }));
      await wait(80);
      return [...document.querySelectorAll('#graphContextMenu button[data-action]')];
    };
    const findField = (label) => [...document.querySelectorAll('#inspectorForm .field')]
      .find((field) => field.querySelector('.field__label')?.textContent.trim().startsWith(label));

    click(firstTransitionLabel());
    await wait();
    const title = document.querySelector('#inspectorTitle')?.textContent.trim() || '';
    const fields = [...document.querySelectorAll('#inspectorForm .field__label')]
      .map((element) => element.textContent.trim());
    const labelControl = findField('转换名称')?.querySelector('input, textarea');
    if (!labelControl || labelControl.disabled) throw new Error('Transition label is not directly editable.');
    const beforeLabel = labelControl.value;
    labelControl.value = beforeLabel + ' 自动化测试';
    labelControl.dispatchEvent(new Event('change', { bubbles: true }));
    await wait();
    const afterEdit = [...document.querySelectorAll('.graph-edge__label')]
      .map((element) => element.textContent.trim())
      .find((text) => text.includes('自动化测试')) || '';
    document.querySelector('#undoButton')?.click();
    await wait();
    click(firstTransitionLabel());
    await wait();
    const afterUndoEdit = findField('转换名称')?.querySelector('input, textarea')?.value || '';

    const edgeButtons = await openContext(firstTransitionLabel());
    const edgeActions = [...new Set(edgeButtons.map((button) => button.dataset.action))];
    const beforeDeleteEdges = edgeCount();
    const removeEdge = edgeButtons.find((button) => button.dataset.action === 'state-edge-delete');
    if (!removeEdge) throw new Error('Transition context menu has no delete action.');
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    removeEdge.click();
    window.confirm = originalConfirm;
    await wait();
    const afterDeleteEdges = edgeCount();
    document.querySelector('#undoButton')?.click();
    await wait();
    const afterUndoDeleteEdges = edgeCount();

    const stateNode = document.querySelector('.graph-node--state-machine:not(.graph-node--pseudo):not(.graph-node--initial-state)')
      || document.querySelector('.graph-node--state-machine:not(.graph-node--pseudo)');
    const stateKey = stateNode?.dataset.key || '';
    let stateButtons = await openContext(stateNode);
    const stateActions = [...new Set(stateButtons.map((button) => button.dataset.action))];
    const initialBefore = document.querySelector('.graph-node--initial-state')?.dataset.key || '';
    const setInitial = stateButtons.find((button) => button.dataset.action === 'state-set-initial');
    if (!setInitial) throw new Error('State context menu has no set-initial action for a non-initial state.');
    setInitial.click();
    await wait();
    const initialAfterSet = document.querySelector('.graph-node--initial-state')?.dataset.key || '';
    document.querySelector('#undoButton')?.click();
    await wait();
    const initialAfterUndo = document.querySelector('.graph-node--initial-state')?.dataset.key || '';
    const currentStateNode = document.querySelector('[data-key="' + CSS.escape(stateKey) + '"]');
    stateButtons = await openContext(currentStateNode);
    const beforeEdges = edgeCount();
    const add = stateButtons.find((button) => button.dataset.action === 'state-add-transition');
    if (!add) throw new Error('State context menu has no add-transition action.');
    add.click();
    await wait();
    const afterAddEdges = edgeCount();
    document.querySelector('#undoButton')?.click();
    await wait();

    return {
      title,
      fields,
      beforeLabel,
      afterEdit,
      afterUndoEdit,
      edgeActions,
      stateActions,
      beforeDeleteEdges,
      afterDeleteEdges,
      afterUndoDeleteEdges,
      initialBefore,
      initialAfterSet,
      initialAfterUndo,
      beforeEdges,
      afterAddEdges,
      afterUndoAddEdges: edgeCount()
    };
  })()`);
}

async function inspectWorkbenchCollection(cdp, label) {
  const count = await evaluate(cdp, `(async () => {
    const button = [...document.querySelectorAll('.collection-tabs button')]
      .find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)});
    if (!button) return -1;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    return [...document.querySelectorAll('.collection-item')]
      .filter((element) => element.getClientRects().length > 0).length;
  })()`);
  return Number(count);
}

async function selectWorkbenchItem(cdp, label) {
  return Boolean(await evaluate(cdp, `(async () => {
    const item = [...document.querySelectorAll('.collection-item')]
      .find((candidate) => (
        candidate.querySelector('.collection-item__title')?.textContent.trim()
          === ${JSON.stringify(label)}
      ));
    if (!item) return false;
    item.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    return [...document.querySelectorAll('.collection-item.is-active')]
      .some((candidate) => (
        candidate.querySelector('.collection-item__title')?.textContent.trim()
          === ${JSON.stringify(label)}
      ));
  })()`));
}

async function inspectUndoableButtonMutation(cdp, buttonLabel, selector) {
  return evaluate(cdp, `(async () => {
    const visible = (element) => element && element.getClientRects().length > 0;
    const count = () => [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter(visible).length;
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => (
        visible(candidate)
          && candidate.textContent.trim() === ${JSON.stringify(buttonLabel)}
      ));
    if (!button) throw new Error('Mutation button is missing: ${safeName(buttonLabel)}');
    const before = count();
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const afterMutation = count();
    document.querySelector('#undoButton')?.click();
    await new Promise((resolve) => setTimeout(resolve, 180));
    return { before, afterMutation, afterUndo: count() };
  })()`);
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
