# Notion -> Obsidian import via API (working recipe, 9 Oct 2026)

What we did, and everything needed to rebuild it (also the base for the future in-app
"database over files" tab). Nothing was modified in Notion: read-only.

## Pipeline
1. Notion integration (Access token `ntn_...`) with "Content access" to the database.
   Token stored locally (never in the repo).
2. Fetch rows: `POST /v1/databases/{id}/query` (Notion-Version 2022-06-28, paginated).
3. Resolve relation targets: `GET /v1/pages/{id}` per id -> titles.
4. Generate files in the vault: one `.md` per row (properties in YAML frontmatter), one
   folder per database. Property names kept verbatim (spaces included).
5. Generate the `.base` file (Obsidian Bases = the database view).
6. Verify with the official Obsidian CLI: `reload`, `open ... newtab`, `base:views`,
   `base:query`, `dev:screenshot`.

## Notion Views API (needs Notion-Version 2025-09-03+, current 2026-03-11)
- `GET /v1/views?database_id=...` returns references only; fetch details with `GET /v1/views/{id}`.
- Full fidelity: name, type (table/board/calendar/gallery/timeline/list/chart/map/dashboard),
  filter, sorts, quick_filters, configuration (visible columns + widths, group_by, wrap, frozen).
- Property IDs differ between API versions: get the modern short ids via
  `GET /v1/databases/{id}` (data_sources[].id) then `GET /v1/data_sources/{id}` (properties).

## Obsidian Bases mapping (verified)
- Notion `table` -> Bases `type: table`; Notion `board` -> Bases `type: kanban` (v1.14+).
- Grouping -> `groupBy: {property: X, direction: ASC|DESC}`; per-view `sort:` list of
  `{property, direction}`; column order -> `order:` list.
- No calendar layout in Bases (as of 1.14): fall back to a table sorted by date.
- Property references with spaces must be BARE and quoted: `'Matrice di Eisenhower'`
  (both in `order:` and `properties:`). Using `note["..."]` shows raw refs and EMPTY values.
- `properties:` keys: bare name for note props; `file.name: {displayName: X}` works.
- The app NORMALIZES the .base when opening it (rewrites: bare refs, properties section
  moved before views, `sort: []` added). External writes are safe, but verify after:
  write -> `obsidian reload` -> open NEW TAB -> screenshot. A tab opened before the change
  can get stuck on "View X not found": reopen in a new tab.

## Gotchas
- Obsidian CLI exists officially (1.12+): Settings -> General -> Command line interface.
  Binary: /usr/local/bin/obsidian. `dev:screenshot` + Read = visual verification without GUI.
- Clicking an unresolved wikilink creates an EMPTY note (0 bytes) - looked like a stray row.
- macOS filesystems are case-insensitive: dedupe generated filenames case-insensitively.
- Relation targets become `[[wikilinks]]`; until the target databases are imported they are
  unresolved (a click creates empty notes).
