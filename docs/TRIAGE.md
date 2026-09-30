# Upstream triage

What this fork took from the original repository's open issues and pull requests (as of 2026-09-30), and why. Every claim below was reproduced against Zotero 10.0.3, Better BibTeX 9.0.64 and pandoc 3.10 unless marked otherwise.

## The root cause of "citation not found"

Two independent bugs stacked on top of each other, and each one failed silently:

1. **Full export is broken.** The plugin requests `/better-bibtex/export/library?/<id>/library.json`. Current Better BibTeX answers `404: library '/1/library.json' does not exist`, because it no longer parses the numeric id. `…export?/library;id:1/library.json` works.
2. **Incremental refresh is broken.** The plugin calls BBT's `item.search`, which now throws `Unexpected Zotero Item type "annotation"` as soon as any PDF annotation was modified since the last sync. The plugin swallowed that error, so the cache was never patched.

On top of that, the stale-cache bookkeeping was wrong: loading the cache set `group.lastUpdate = Date.now()`, so the next incremental refresh asked only for changes *after now* and skipped everything in between. And the manual *Refresh bibliography* command cleared the in-memory bibliography before re-downloading, so a failed download left it empty. That is exactly what was reported in #151 ("when I manually refresh, all my old citations disappear").

Net effect on a real library: a July cache with 860 entries, 16 references missing (every one added since).

## Adopted

| Upstream | What | How it was done here |
|---|---|---|
| #153 | Use Zotero's native citation keys, no Better BibTeX | New provider on Zotero's local API. Verified that the native `citationKey` equals BBT's key for all 876 entries of the test library, and that `csljson` output works as a pandoc bibliography. BBT stays as a fallback (`Automatic` mode). |
| #154, #151, #140, #135, #123, #88, #137 | Stale library; new references not picked up | Sync is keyed on Zotero's **library version** instead of timestamps: one tiny request answers "anything new?", and only changed items are fetched (`since=`). Deletions and cleared citation keys are handled. Triggers: plugin start, window focus, opening `@` suggestions, and the *Refresh bibliography* command. Not adopted from #154: its fixed 60 s timer and the blocking refresh. |
| #154 | `lastUpdate` set when loading from cache | Gone: state is the library version stored in the cache itself. |
| #154 | Export URL `library;id:N` | Used by the BBT fallback, with the old form tried second for older BBT versions. |
| #154 | `noteIndex` attribute should be `data-note-index` | Adopted. The tooltip reads `data-note-index` but the editor decoration wrote a differently named attribute, so note-style tooltips in Live Preview could not find their note. Found by reading the code; the effect inside Obsidian is not verified. |
| #141 | `Unexpected end of JSON input` | Caches are written to a temp file and renamed, and a BBT export is parsed *before* anything is cached. A corrupt cache is ignored, never fatal. |
| #110, #122 (probably the same root cause, not confirmed), #155 | Silent failures, "Cannot connect" | Connection state is surfaced: status bar icon, Notice when Zotero's local API is off, retry with backoff when Zotero isn't up yet (Obsidian often starts before Zotero). |
| #155 | A renamed CSL style caches "404: Not Found" as if it were a style | Downloads check the HTTP status and that the body is XML; a bad cached file is ignored and re-downloaded. |
| #161 | Sidebar says "No citations found" when the style omits an entry type (Chicago + interview) | Diagnosis correct and reproduced with citeproc: `entry_ids` has one more element than the rendered entries. Their fix skips tagging *every* entry when the counts differ, which loses the literature-note and Zotero links. Here each entry is matched to its id by probing which ids the style suppresses. |
| #160 (one hunk) | `state.inKey = false` after `;` | `[So @a; see also @b]` read "see also" as a *suffix* of `@b`; pandoc treats it as a prefix. Reproduced with a failing test, then fixed. |
| #127, #162 | `setViewContent is not a function` | `plugin.view` returned `leaf.view` without checking its type; Obsidian 1.7+ leaves can hold a `DeferredView`. Now an `instanceof` check, and a deferred leaf is loaded instead of a second pane being opened. (Not verified inside Obsidian.) |
| #140, #135, #151 | Request for a refresh command | *Refresh bibliography* and *Rebuild Zotero cache* are commands now. |

## Rejected

| Upstream | Why |
|---|---|
| **#160** (the main change) | Claims pandoc passes `{…}` contents through as a bare locator. It does not: `[@smith{pp. 33-35}]` renders `(Smith, 2020, pp. 33–35)` with APA, and pandoc still recognises the `pp.` label and normalises the dash. Adopting it would make the plugin *diverge* from pandoc, the opposite of its stated goal. |
| #156 | 1,600 added / 1,500 removed lines, almost all line-ending churn in `bibManager.ts`, `package.json`, the locales and the manifest; impossible to review. The *idea* (allow frontmatter `bibliography` with no global path) is sound and is on the to-do list. |
| #138 | Not a plugin bug. `2023a` / `2023b` is CSL year-suffix disambiguation, which depends on which items the document cites, not on the Zotero key. (Read from the issue thread; not reproduced.) |

## Deferred (good ideas, not needed to fix the sync)

- **Frontmatter bibliography** (#136, #92, #118, #129, #128, PR #158, the idea behind #156): relative paths, lists of files, no global path required. Wanted, but independent of Zotero sync.
- **Citekey suggestion search** (PR #85): multi-term search and triggering after `(`. Reasonable, from 2023, touches the same code as the suggest fix; to be redone on top of the current code.
- **Documenting citation syntax** (PR #144): docs only.
- Feature requests: full-note citations in Live Preview (#133), graph nodes (#159), Canvas (#149), literature-note creation (#104, #99), Slides (#100), theme colours (#145).

## Not investigated

The remaining ~80 issues were triaged by title only. Several describe parser edge cases (#124, #119, #117, #86, #78, #125), rendering in tables/callouts/footnotes (#121, #93, #147, #139, #157) and multilingual CSL (#142, #48). They are not regressions from this fork's changes, and none were claimed as fixed.

## What is not verified

The Zotero sync, caching, fallback and CSL handling are covered by tests (a fake Zotero server, plus a run against a live Zotero). The Obsidian-side behaviour (window-focus refresh, the settings panel, the deferred-view fix, the status bar icon) compiles and type-checks, but could only be exercised inside Obsidian.
