# fwe

`fwe` is a generic file-workspace editor runtime. It is designed to live as an independent repository or git submodule. Game-specific editors should depend on it through app config, domain files, and small extensions.

## Quick Start

Requirements: Node.js 18 or newer.

```powershell
npm start
npm test
node bin/fwe.js --explain flow --app examples/app.fwe.json
```

`npm start` serves the bundled example app. By default it prints the local URL and does not open a browser automatically. Use `node bin/fwe.js --app examples/app.fwe.json --open` when you want fwe to open the browser for you.

## Project Layout

| Path | Purpose |
| --- | --- |
| `bin/fwe.js` | CLI entry point |
| `src/` | server, source loading, DSL compilation, and extension loading |
| `public/runtime.js` | browser registry API for views, forms, slots, and workbench layouts |
| `public/app.js` | app shell, file operations, history, workbench, validation, and shared helpers |
| `public/graph.js` | fixed graph, free graph, route-lane layout, and blueprint rendering |
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
  "domains": [
    "./domains/items.fwe",
    "./domains/flow.fwe"
  ]
}
```

Run directly:

```powershell
node bin/fwe.js --app examples/app.fwe.json
node bin/fwe.js --check --app examples/app.fwe.json
node bin/fwe.js --explain flow --app examples/app.fwe.json
```

## DSL

New domains should use `.fwe` files.

```text
id items
title "Items"
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
- `workbench`: composite multi-collection editor. `layout catalog` is a catalog browser; `layout panels` is a three-panel workspace.
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

Return `true` or omit the return value after handling a request. Return `false` to try the next matching parent prefix and then fwe's normal 404 response. More specific prefixes run first; duplicate prefixes and fwe's reserved `/api/app`, `/api/domains`, and `/api/extensions` routes are rejected. API extensions run in the server process and are trusted code; keep game-specific paths and persistence rules in the host repository.

## Tests

```powershell
npm test
npm run test:browser
npm run pack:dry
```

`npm test` runs syntax, example compilation, and unit tests on Node.js 18 or newer. `test:browser` additionally requires Node.js 22 or newer and a local Chrome or Chromium installation; it checks every example domain for browser errors, layout overflow, and graph add/undo behavior.

## Form Extensions

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

Form context includes `field`, `target`, `value`, path helpers, option helpers, `setValue`, `onChange`, and `renderInspector`.

## Compatibility Aliases

The canonical API is `source / model / view / form`.

For older local configs, fwe still accepts these aliases at the boundary:

- DSL block `surface` is read as `view`.
- View property `renderer` is read as `view`.
- Field property `widget` is read as `form`.
- Client APIs `registerRenderer` and `registerWidget` forward to `registerView` and `registerForm`.

Compiled domains and current examples use the canonical names only.
