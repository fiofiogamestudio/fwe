# Changelog

## Unreleased

- Restored JSON/DSL domain runtime-equivalence checks through the `--compare` CLI and reusable package API, sharing the browser's public domain projection so new runtime fields cannot be skipped silently.
- Added optimistic revisions for built-in and custom sources, transactional built-in writes, stale-write diagnostics, and refresh/close guards for unsaved browser edits.
- Isolated app launch fingerprints to each app's declared extension dependency graph while retaining shared-dependency change detection.
- Unified framework tab semantics, roving keyboard focus, accessible status announcements, and configuration-driven shell, markup, and graph-action messages.
- Added per-collection graph node views, labeled detail rows, orthogonal-grid derived edges, and display-label mappings for dynamic select options.
- Added declarative catalog collection filters with dynamic options, relational member matching, default selections, detail/grid parity, and deep-link reveal behavior.
- Added generic Workbench resource links with text or accessible icon-button presentation, shareable domain/file/collection/item routes, new-tab opening, and browser-session handoff.
- Added main-area `form-json` page presentation while preserving native resource, history, validation, and save behavior.
- Exposed resource data, file metadata, and structured selection to form extensions.
- Added collection/item data attributes and structured diagnostics validation for native Workbench hosts.
- Fixed no-inspector Workbenches instantiating a second hidden form and fixed duplicate non-graph form rendering after edits.
- Added a reusable browser multi-select control with grouped/count options, bulk actions, popup lifecycle handling, and a stable `fwe.ui` API.
- Added one canonical `start.bat` that opens the bundled example app.
- Reused an already-running copy of the same app and rejected unrelated services on the configured port.
- Added launch fingerprints so changed app, domain, extension, or FWE runtime files cannot silently reuse an outdated server.
- Preserved opaque source metadata through list/open/save and exposed generic browser resource lifecycle events and commands.
- Added browser-session request context and structured workbench selection events for host extensions with per-session state.
- Allowed trusted API extensions to return an explicit text MIME type so dynamically served scripts and styles load correctly.

## 0.2.0

- Added scoped server API handlers for trusted host extensions through `registerApi`.
- Fixed workbench inspector form resolution after a collection changes the active selection.
- Added unit tests for extension routing and source persistence plus a reusable headless-browser smoke runner.

## 0.1.0

- Added the standalone fwe CLI and local editor server.
- Added the `.fwe` DSL compiler for source, model, view, form, refs, and validation config.
- Added built-in views for object forms, tables, fixed route-lane graphs, free integer-grid graphs, blueprint graphs, workbench layouts, and text files.
- Added browser runtime registries for custom views, forms, slots, and workbench layouts.
- Added bundled examples for settings, items, tasks, flow graph, blueprint graph, custom dice layout, and text editing.
