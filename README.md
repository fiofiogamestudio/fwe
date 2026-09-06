# fwe

`fwe` is a generic file-workspace editor runtime. It is designed to live as an independent repository or git submodule. Game-specific editors should depend on it through app config, domain files, and small extensions.

### Component boundary

FWE does not require FW, FWA, Godot, or a game runtime. A game built with FW does not need FWE either: interoperability belongs in optional app/source/model adapters, not in either framework's core. Generated metadata such as FW's `_config_schema.json` can be input to such an adapter; this repository does not claim to automatically import that format or arbitrary CSV layouts. Keep one authoritative schema, derive the editor model, and validate/save through the source contract below. Wide integers should remain decimal strings through JavaScript editors, rather than being coerced through `Number`.

## Quick Start

Requirements: Node.js 18 or newer.

```powershell
start.bat
npm test
node bin/fwe.js --explain flow --app examples/app.fwe.json
```

`start.bat` is the canonical Windows launcher. It serves the bundled example app and opens the browser automatically. `npm start` provides the same behavior. Pass `--no-open` or set `FWE_NO_BROWSER=1` when you only want the server. If the same app revision is already running, fwe reuses it. If app, domain, extension, or runtime files changed, fwe rejects the outdated server with an explicit restart message instead of mixing old server state with new browser files. A port owned by another app or service is rejected as well.

## Project Layout

| Path | Purpose |
| --- | --- |
| `start.bat` | canonical Windows launcher for the bundled example app |
| `bin/fwe.js` | CLI entry point |
| `src/` | server, source loading, DSL compilation, and extension loading |
| `public/runtime.js` | browser registry API for views, forms, slots, workbench layouts, and reusable controls |
| `public/app.js` | app shell, file operations, history, workbench, validation, and shared helpers |
| `public/graph.js` | fixed graph, free graph, route-lane/tree layout, and blueprint rendering |
| `public/inspector.js` | inspector form rendering and JSON mode |
| `public/views/` | small built-in view registrations |
| `templates/` | built-in model and domain templates |
| `examples/` | self-contained example app and workspace |

## Public Model

fwe uses four public concepts:

- `source`: where editable files or virtual files come from.
- `model`: the data contract, including object fields, arrays, keys, refs, graph edges, and validation.
- `view`: the main editor area for one domain, such as form, table, graph, workbench, text, or a custom app view.
- `form`: inspector field rendering, including built-in field types and optional custom field forms.

The runtime path is:

```text
app config
  -> domain .fwe or JSON config
  -> compiled domain { source, model, refs, validate, view, inspector.forms }
  -> view registry + form registry
```

The canonical names are `source`, `model`, `view`, `form`, `modes`, `layout`, and `list`.

## App Config

```json
{
  "id": "fwe-example",
  "title": "fwe Example",
  "workspace": "./workspace",
  "port": 3219,
  "navigation": {
    "defaultWorkspace": "authoring",
    "defaultSection": "items",
    "workspaces": [
      {
        "id": "authoring",
        "label": "Authoring",
        "sections": [
          { "id": "items", "label": "Items", "domain": "items", "collection": "items", "hideFile": true },
          { "id": "flow", "label": "Flow", "domain": "flow" }
        ]
      }
    ]
  },
  "domains": [
    "./domains/items.fwe",
    "./domains/flow.fwe"
  ]
}
```

Run directly:

```powershell
start.bat
node bin/fwe.js --app examples/app.fwe.json
node bin/fwe.js --replace --app examples/app.fwe.json
node bin/fwe.js --check --app examples/app.fwe.json
node bin/fwe.js --explain flow --app examples/app.fwe.json
node bin/fwe.js --compare legacy.fwe.json migrated.fwe --app examples/app.fwe.json
```

`--compare` compiles both JSON/DSL domain files and compares the exact domain contract exposed to the browser. Source-format metadata is ignored, while group, source, model, graph, refs, validation, actions, save, columns, inspector/forms, views/modes, defaults, and workbench configuration must remain equivalent.

## DSL

New domains should use `.fwe` files.

```text
id items
title "Items"
group "Gameplay"
source "folder-json:items"

data Root {
  items: Item[]
}

type Item {
  id: int @key
  name: string
  rarity: string = "common" @enum("common", "rare", "epic")
}

view table items {
  columns [id, name, rarity]
  modes [table, detail, json]
}
```

DSL layers:

- `group "Name"` places the domain under the first-level app navigation group; the toolbar is `group -> domain -> file`.
- `source "type:path"` binds the file source.
- `data Root { ... }` defines the root model.
- `type Name { ... }` defines reusable object models.
- `view kind [target] { ... }` chooses the editor view.
- `modes [...]` lists states inside that view, such as `table`, `detail`, `canvas`, or `json`.
- `layout name` selects a composite view layout, such as `catalog` or `panels` for `workbench`.
- `list [...]` lists collection item presentations, such as `detail` and `grid`.

Core annotations:

- `@key`: identity inside an array.
- `@edge`: graph edge field.
- `@entry`: graph entry field.
- `@position`: free graph integer-grid position object.
- `@label`, `@hint`, `@placeholder`, `@textarea`, `@enum`, `@range`, `@pattern`, `@length`, `@items`: form and validation hints.

## Built-In Views

Built-in view modules live in `public/views/*.js`.

- `form-json`: object form plus JSON mode.
- `table`: keyed array table.
- `graph-fixed`: route-lane graph, no saved coordinates.
- `graph-free`: integer-grid movable graph.
- `graph-blueprint` with `layout tree`: measured, deterministic top-to-bottom tree layout; saved coordinates are ignored.
- `workbench`: composite multi-collection editor. `layout catalog` is a catalog browser; `layout panels` is a three-panel workspace.
- `workbench` with `layout dense`: compact two-panel collection editing with multi-column forms.
- `text`: direct text editor.

Fixed graph:

```fwe
view graph nodes {
  layout route-lane
  entry entry
  modes [canvas, json]

  node {
    badge kind
    title "Node {id}"
    body text
    details [next, fail]
  }
}
```

Free graph:

```fwe
view graph nodes {
  layout free grid 10
  entry entry
  modes [canvas, json]

  node {
    badge kind
    title title
    body text
    details [next]
  }
}
```

Free graph positions are stored as integers. With `grid 10`, `{ "x": 12, "y": 8 }` renders at `120px, 80px`.

Tree blueprints use `layout tree`. Control edges define parent-child relationships, sibling order comes from `values.order`, and branch output ports must opt into multiple connections explicitly. `profile behavior-tree` enables the strict behavior-tree presentation; node `category` values such as `root`, `composite`, `decorator`, `condition`, and `action` control semantic styling without entering saved data. A node type may declare `description "..."`; the behavior-tree card then explains the stable meaning of that type. A blueprint may also declare `note note`, where the first `note` enables instance notes and the second is the saved node field path. Instance notes remain outside `values`, so runtimes that only consume blueprint values can ignore authoring comments cleanly. Left-click selects a node for property editing. Right-click opens structural commands for adding a compatible child, moving sibling priority, duplicating a subtree, or deleting a subtree; right-drag pans the canvas. Strict tree profiles intentionally do not expose arbitrary cable drawing because the editor preserves one root, one parent per non-root node, and port cardinality while each command is applied.

State-machine domains can use `profile state-machine`. The renderer keeps authored states as compact nodes, transitions as labeled edges, the initial marker separate, and cycle edges on dedicated return lanes. Forward, return, and self-loop routes use distinct visual styles without changing saved data. Left-click a state to edit its properties, or click a transition line/label to edit the referenced repeater item directly. Right-click a state to change the initial state, add a transition, or delete the state; right-click a transition to edit or delete it. Profile metadata only changes presentation; runtime semantics remain in the edited JSON.

For built-in JSON sources, a root-level optional string `alias` is displayed after the file name as `file.json（alias）`. The file path and authored IDs remain stable, so aliases can be changed without breaking references.

JSON graph domains may use `nodeViews` to give each node collection its own badge, title, body, and labeled detail rows. A grid graph may also declare `derivedEdges.type: "orthogonal-grid"`; FWE then connects Manhattan-adjacent positions unless an explicit configured link list is present. These options change presentation and edge discovery only; node data remains owned by the host domain.

## Workbench

Use `workbench` when one domain needs multiple collections, shared search, item forms, previews, references, or a custom workspace-like composition.

Catalog layout:

```fwe
view workbench {
  layout catalog
  default {
    collection records
    list detail
    mode overview
  }
  inspector false

  collection records {
    path records
    title title
    subtitle [id, type, status]
    search [id, title, type, summary]
    columns [id, title, type, status]
    list [detail, grid]
    modes [overview, json]
  }
}
```

Panels layout:

```fwe
view workbench {
  layout panels
  default {
    collection projects
    list detail
    mode overview
  }
  diagnostics true

  collection projects {
    path projects
    title name
    subtitle [id, owner, status]
    modes [overview, json]
  }
}
```

`layout` controls the whole workbench shape. `default` controls the initial workbench state. `list` controls how one collection list is shown. `modes` controls the selected item editor.

Large JSON Workbench definitions may declare ordered `collectionGroups` and assign each collection with `group`. The catalog renders a compact group/collection navigator; Workbenches without groups keep the original single-level tabs.

Catalog collections can declare reusable multi-select filters. Filters combine with AND, while selected options inside one filter combine with OR. Clearing one filter intentionally shows no rows. Options may compare directly against an item field or declare a relation through an option-owned member list:

```json
{
  "id": "records",
  "path": "records",
  "filters": [
    {
      "id": "pool",
      "label": "Pool",
      "itemValue": "id",
      "options": {
        "path": "metadata.pools",
        "value": "id",
        "label": "name",
        "count": "memberCount",
        "members": "memberIds",
        "defaultWhen": ["primary"]
      }
    }
  ]
}
```

`navigation` is optional. When present, the shell renders a persistent desktop workspace/section sidebar and equivalent narrow-layout selectors instead of the technical domain selector. A section targets one domain and may target one workbench collection; collection targets hide the workbench's duplicate collection tabs. `hideFile` removes an implementation-only singleton file selector while preserving the underlying file resource. Workspace and section IDs must be unique, and every referenced domain and collection is validated during `--check`.

Without `members`, set `itemPath` to the scalar or array field matched against option values. `default` accepts `"all"`, `"none"`, or an explicit value array. When `default` is omitted, options matching any `defaultWhen` field are selected; if none are marked, all options are selected. Filter state is reset when a resource changes, and deep links automatically reveal their target through configured relational filters.

Compatibility input is still accepted: old `view browser` maps to `view workbench { layout catalog }`, old `view sidepanel` maps to `view workbench { layout panels }`, old collection `layouts` maps to `list`, and old `defaultCollection/defaultList/defaultMode` maps to `default { collection/list/mode }`.

## Source Extensions

Use a source extension when the editable item is not a direct file.

```js
module.exports = (fwe) => {
  fwe.registerSource('json-array', {
    list(ctx) {
      const data = ctx.readJson(ctx.source.file);
      return data[ctx.source.array].map((row) => ({
        name: `${row[ctx.source.id]}.json`,
        label: row[ctx.source.label]
      }));
    },
    read(ctx, name) {
      const id = name.replace(/\.json$/i, '');
      const data = ctx.readJson(ctx.source.file);
      const row = data[ctx.source.array].find((item) => String(item[ctx.source.id]) === id);
      return { type: 'json', data: { [ctx.source.array]: [row] } };
    },
    write(ctx, name, payload) {
      const id = name.replace(/\.json$/i, '');
      const data = ctx.readJson(ctx.source.file);
      const row = payload.data[ctx.source.array][0];
      const index = data[ctx.source.array].findIndex((item) => String(item[ctx.source.id]) === id);
      data[ctx.source.array][index] = row;
      ctx.writeJson(ctx.source.file, data);
      return { name };
    }
  });
};
```

## Workbench Layout Extensions

Use a workbench layout extension when a domain is still a multi-collection workbench, but the main layout is project-specific. The extension lives in the host app, not in the fwe core package.

App config:

```json
{
  "extensions": [
    { "client": "./extensions/dice-cross.layout.js" }
  ]
}
```

Domain:

```fwe
view workbench {
  layout dice-cross
  default {
    collection dice
    list detail
    mode cross
  }
  slot slot
  face face
  locked locked
  slots [top, left, center, right, bottom]

  collection dice {
    path dice
    title face
    modes [cross, json]
  }
}
```

Client extension:

```js
(function () {
  window.fwe.registerWorkbenchLayout('dice-cross', {
    validateLayout(layout) {
      const issues = [];
      const view = layout.view;
      if (!view.slot) issues.push('dice-cross needs a slot field.');
      if (!view.face) issues.push('dice-cross needs a face field.');
      return issues;
    },
    render(ctx, layout, workbench) {
      ctx.showView('document');
      const dice = workbench.getRows();
      ctx.hosts.documentTree.replaceChildren(renderDiceBoard(dice, ctx));
    }
  });
}());
```

`layout` contains the selected runtime view and layout id. `workbench` contains normalized collections, the active collection, current workbench state, and `getRows()`. The normal view context still includes `app`, `domain`, `view`, `file`, `data`, `selection`, path helpers, history helpers, built-in render helpers, refs, and DOM hosts.

Use a full custom view only when the domain is not a workbench at all.

## Server API Extensions

Trusted host extensions can expose project-specific HTTP endpoints without replacing the fwe server. Each handler is restricted to its registered `/api/...` prefix.

```js
module.exports = (fwe) => {
  fwe.registerApi('/api/project', async ({ req, res, url, sendJson, readBody, parseJson }) => {
    if (req.method === 'GET' && url.pathname === '/api/project/status') {
      sendJson(200, { ready: true });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/project/run') {
      const input = parseJson(await readBody());
      sendJson(200, { input });
      return true;
    }
    return false;
  });
};
```

Every successful read carries an opaque revision token. Built-in sources hash the bytes actually read, including each physical input of a multi-file resource; a save returns the revision of the content it published, not a later reread. FWE derives a token from custom-source content when a provider omits one. The browser returns that revision on save. If the resource has changed or disappeared, the save receives HTTP `409` with a `revision-conflict` issue. Calls that omit both `revision` and `createOnly` retain legacy unconditional-write behavior; new clients should always send one of these preconditions.

`POST /api/domains/:id/files` and `PUT /api/domains/:id/files/:name` with `createOnly: true` create a resource only when it does not already exist. A collision returns HTTP `409` with a `file-exists` issue. Built-in sources publish prepared files with a filesystem-exclusive hard link, so a competing process cannot win between an existence check and publication and then be overwritten. Unsupported filesystems fail the operation rather than falling back to an overwriting rename. A multi-json create requires every physical target to be absent; if any target exists, FWE preserves it and rolls back only files created by this attempt.

Custom-source mutations are queued by domain ID and resource name within one loaded app instance, across browser sessions. Revision read/check, the awaited provider write, and its result revision stay in that queue; named `create` and `delete` operations use the same queue. A preconditioned custom write or named create requires `read()` to distinguish an existing resource from a missing one: report a missing resource with HTTP-style `status: 404`, `code: 'ENOENT'`, or a read result containing `exists: false`. Other errors fail closed. Providers receive `createOnly: true` and must enforce atomic creation themselves against other processes. Providers that allocate names, alias several names/domains to one resource, or span multiple physical resources remain responsible for uniqueness, shared-resource locking and aggregate transactions. They may return their own revision to describe a host transaction accurately.

Built-in JSON, text, and multi-file writes prepare temporary files before replacing targets and attempt to roll back already-replaced targets if a later replacement fails. This is not a crash-recovery journal or a cross-process compare-and-swap transaction: a non-cooperating external writer can still race a normal revision check, and a crash can leave temporary/backup files or a partially published multi-file save. Keep independently writing tools coordinated. Text sources and `ctx.readText` / `ctx.writeText` preserve the supplied UTF-8 text, including BOM, CRLF, empty content and trailing whitespace; JSON sources continue to format JSON.

Built-in sources and the path-aware `ctx` file helpers reject lexical traversal and symbolic links/junctions below the configured workspace with HTTP `403` and a `workspace-path-escape` issue. Existing ancestors are checked even when the target file or its parent directories do not exist yet. The explicitly configured workspace root may itself be a link. Descendant links are rejected even when they point back inside the workspace, keeping read and atomic-replacement semantics consistent. This is a local-workspace safety policy, not a sandbox against a process that can concurrently replace filesystem paths. Server extensions are trusted Node code and can deliberately bypass helpers through `ctx.fs`; they retain responsibility for any such access.

### Browser resource lifecycle

A save captures its resource identity, open generation and content snapshot. Saves for the same resource are queued and reuse the preceding successful revision. A response only updates the still-current opening of that resource; switching domains/files cannot transfer its revision or diagnostics to another editor. Later text, JSON draft or focused form edits remain dirty and are not remounted by a save response. Resource loading disables editing and saving until a successful read; reopening a resource waits for its pending saves before reading it again.

New drafts carry `exists: false` and use `createOnly` on their first save, so a file created externally after the draft opened receives a visible conflict rather than being overwritten. Resource lifecycle events describe the current editor; a save that completes after leaving that resource returns its result to its caller without emitting an event labeled as the new selection.

### Reusable Browser Controls

Custom views should use FWE controls for interaction patterns that are not domain-specific. The multi-select control owns its popup, grouping, counts, select-all/clear actions, outside-click and Escape handling, and change events. The host supplies only labels, items, selected values, and domain behavior:

```js
const filter = window.fwe.ui.createMultiSelect({
  id: 'kindFilter',
  placeholder: '类型',
  selectAllLabel: '全选',
  clearLabel: '清空',
  items: [
    { value: 'buff', label: 'Buff', group: '战斗', count: 12 },
    { value: 'item', label: '道具', group: '奖励', count: 8 }
  ],
  selected: ['buff']
});
filter.addEventListener('change', (event) => applyKinds(event.detail.values));
host.append(filter);
```

Use `configure(...)` for non-emitting model updates, `value` or `setValue(...)` for selection, `selectAll()` / `clear()` for commands, and `open` / `close()` for popup state. Set `--fwe-multi-select-width`, `--fwe-multi-select-menu-width`, and `--fwe-multi-select-menu-max-height` on the returned element when a host layout needs different dimensions. Keep option discovery and filtering semantics in the host extension.

Workbench references should use FWE resource links instead of assembling app URLs in host code. The helper preserves the current domain, file, and browser session, writes a stable collection/item deep link, and opens a new tab by default:

```js
const link = ctx.createResourceLink({
  label: 'Guard (guard)',
  title: 'Open Buff: Guard',
  presentation: 'icon',
  collectionId: 'buffs',
  itemId: 'guard',
  mode: 'overview'
});
host.append(link);
```

Use `presentation: 'icon'` for a compact icon-only control. Its `label` or `title` becomes the accessible name and hover tooltip; the host should render the readable resource name as ordinary text beside it. Omitting `presentation` retains a normal text link. The same API is available as `window.fwe.ui.createResourceLink(...)`. Use `window.fwe.navigation.href(...)` when only the URL is needed, `navigate(...)` for same-page navigation, `open(...)` for imperative new-tab navigation, and `restore()` to reapply the current URL after a host-driven resource reload. Collection ids, labels, and reference discovery remain host-domain configuration; FWE owns only routing and link behavior.

Source entries and `read` / `write` / `create` results may include an opaque `meta` object. FWE preserves it without interpreting host semantics. Browser extensions can observe resource state through:

```js
window.fwe.resources.current();
await window.fwe.resources.saveCurrent();
await window.fwe.resources.reloadCurrent();
await window.fwe.resources.refresh();
window.fwe.session.id;
window.fwe.session.handoff;
window.fwe.session.headers({ 'Content-Type': 'application/json' });
```

The shell dispatches `fwe:resources-listed`, `fwe:resource-opened`, `fwe:resource-saved`, `fwe:resource-cleared`, and `fwe:selection-changed` events. Resource snapshots include file metadata, dirty state, and a structured selection with `domainId`, `fileName`, and `key` plus workbench `collectionId`, `collectionPath`, and `itemId` when available. Host extensions should use this lifecycle for provenance, source-control, or adjacent resource UX while leaving their domain rules outside FWE core.

Core API requests automatically send the page's `X-FWE-Session` value. Source-provider contexts and server API-extension handlers receive it as `sessionId`; custom browser fetches must merge `window.fwe.session.headers(...)` into their request headers. The ID survives reloads in one browser session but does not make mutable host state process-global. A resource link marks the destination page's session as `handoff: true`, allowing host extensions to retain server-side context instead of replacing it with empty tab-local state. Headerless tools retain the `default` compatibility session.

Return `true` or omit the return value after handling a request. Return `false` to try the next matching parent prefix and then fwe's normal 404 response. More specific prefixes run first; duplicate prefixes and fwe's reserved `/api/app`, `/api/domains`, and `/api/extensions` routes are rejected. `sendText(status, text, contentType)` accepts an explicit MIME type for scripts and styles. API extensions run in the server process and are trusted code; keep game-specific paths and persistence rules in the host repository.

## Tests

```powershell
npm test
npm run test:browser
npm run test:all
npm run pack:dry
```

`npm test` runs syntax, example compilation, and unit tests on Node.js 18 or newer. `test:browser` additionally requires Node.js 22 or newer and a local Chrome or Chromium installation. It checks every example domain for browser errors, layout overflow and graph add/undo, then creates an isolated temporary host for real create/edit/save/reopen, conflict, in-flight editing and navigation tests against HTTP and disk. `test:browser:lifecycle` runs only this second suite. CI runs both browser suites on Node.js 22 and uploads their evidence; `test:all` runs the unit/browser suites and verifies the published package contents. Browser textareas may normalize line endings; server text persistence preserves the exact string it receives, not necessarily the original file's byte encoding after a browser edit.

For a focused custom-form probe, `browser-smoke.js` accepts `--domain`, `--file`, `--collection`, `--item`, and `--expect-selector`. Pair `--mutation-button` with `--mutation-selector` to verify that a visible button increases the selected node count and Undo restores it.

## Form Extensions

Dynamic select fields can keep stable stored values while presenting readable labels with `optionLabels`:

```json
{
  "path": "effect",
  "type": "select",
  "optionsFrom": "props.effect.values",
  "optionLabels": {
    "shake": "Shake",
    "wave": "Wave"
  }
}
```

Values not present in `optionLabels` retain their source label, so host-defined extensions remain editable.

Use a form extension when one inspector field needs a special control.

Field config:

```json
{
  "path": "score",
  "label": "Score",
  "form": "rating-stars",
  "max": 5,
  "value": "int"
}
```

Client extension:

```js
(function () {
  window.fwe.registerForm('rating-stars', {
    validateField(field) {
      return field.path ? [] : ['rating-stars needs field.path.'];
    },
    render(ctx, field, value) {
      const root = document.createElement('div');
      const max = Number(field.max || 5);
      for (let score = 1; score <= max; score += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = score <= Number(value || 0) ? '*' : '.';
        button.addEventListener('click', () => ctx.setValue(score, { refresh: true }));
        root.append(button);
      }
      return root;
    }
  });
}());
```

Form context includes `app`, `domain`, `data`, `file`, `selection`, `context`, `field`, `target`, `value`, path helpers, option helpers, `setValue`, `onChange`, `renderInspector`, `navigation`, and `createResourceLink`. Set a field's `label` to `false` when the extension renders the complete field surface and does not need an outer label.

For a document whose root form should occupy the main editor area instead of the side inspector, use the built-in form view's page presentation:

```json
{
  "view": [
    {
      "type": "form",
      "view": "form-json",
      "presentation": "page",
      "modes": ["form"]
    }
  ]
}
```

The page presentation keeps the normal FWE resource bar, history, validation, and save lifecycle. It only changes where the root form is rendered.

## Compatibility Aliases

The canonical API is `source / model / view / form`.

For older local configs, fwe still accepts these aliases at the boundary:

- DSL block `surface` is read as `view`.
- View property `renderer` is read as `view`.
- Field property `widget` is read as `form`.
- Client APIs `registerRenderer` and `registerWidget` forward to `registerView` and `registerForm`.

Compiled domains and current examples use the canonical names only.
