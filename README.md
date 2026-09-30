# Better Pandoc Reference List

An Obsidian plugin that turns [Pandoc citations](https://pandoc.org/MANUAL.html#citations) in your notes into formatted references. Write `[@smith2020]` and the plugin shows "(Smith, 2020)" in your text and the full reference in the sidebar, in the citation style you choose (APA, Chicago, Vancouver, and thousands more).

This is a maintained fork of [Pandoc Reference List](https://github.com/mgmeyers/obsidian-pandoc-reference-list) by Matthew Meyers, which is no longer maintained. What changed is listed in [docs/TRIAGE.md](docs/TRIAGE.md).

## How it works

1. **You cite.** In a note you type a citation in Pandoc format, for example `[@smith2020]`, `[@smith2020, p. 14]` or `@smith2020 says that...`. The part after `@` is the *citation key* of a reference.
2. **The plugin finds the reference.** It reads your reference library and matches each citation key to a reference.
3. **The plugin formats it.** Using the citation style you picked (a CSL style), it renders the citation in your text, shows a tooltip when you hover over it, and builds the list of references in the sidebar. You can copy that list into your note.

So the plugin needs to know where your references are. There are two ways, and you choose one in the plugin settings.

### Option 1: Zotero (recommended)

Every reference in Zotero has a **Citation Key**. It is the same key that other tools use, such as the *Zotero Integration* plugin for Obsidian, so what you insert from there matches what this plugin reads. If you use Better BibTeX, it fills in that field for you.

The plugin reads your library straight from the Zotero app running on your computer. You do not need any extra Zotero add-on.

To set it up:

1. In Zotero, open **Settings → Advanced** and turn on **"Allow other applications on this computer to communicate with Zotero"**.
2. In Obsidian, open the plugin settings and turn on **Pull bibliography from Zotero**.
3. Pick the libraries to include (your own library, and group libraries if you use them).

Keep these in mind:

- Zotero must be **running** to get new references. If it is closed, the plugin keeps working with what it already knows.
- References that have **no Citation Key** cannot be cited, so they are not listed.

### Option 2: Better BibTeX

If Zotero's own connection is not available, the plugin can ask [Better BibTeX](https://retorque.re/zotero-better-bibtex/) (a Zotero add-on) for your library instead. In the settings, set **Zotero data source** to *Better BibTeX*. The default, *Automatic*, tries Zotero first and falls back to Better BibTeX by itself.

### Not using Zotero?

Set **Path to bibliography file** to a bibliography file that Pandoc can read (`.bib`, `.json`, `.yaml`...). You can also set `bibliography` in a note's frontmatter to use a different file for that note.

## Staying up to date

You do not need to do anything when you add a reference in Zotero. The plugin checks for changes:

- when you switch back to Obsidian,
- when you type `@` and the suggestions open,
- and when you run **Refresh bibliography** (see below).

A check is very cheap. The plugin only downloads what changed, so it stays fast even with a large library.

### The first time

The first time you turn the plugin on, it imports your whole Zotero library. With a big library this takes a few seconds, and a message shows the progress. It happens once; after that only changes are downloaded.

### Where the data is stored (the cache)

To start quickly, and to keep working when Zotero is closed, the plugin keeps a copy of your reference list, called a **cache**. It is stored on your computer, **outside your vault**, so it is not synced between your devices:

| System | Location |
| --- | --- |
| Windows | `%LOCALAPPDATA%\better-pandoc-reference-list\` |
| macOS | `~/Library/Caches/better-pandoc-reference-list/` |
| Linux | `~/.cache/better-pandoc-reference-list/` |

Each device builds its own cache. It is safe to delete; the plugin simply imports your library again. The downloaded citation styles and languages are kept in a hidden `.pandoc` folder inside your vault.

### If something goes wrong

- If Zotero is closed or cannot be reached, the plugin keeps using its cache and tries again in the background. The `@` icon in the status bar (bottom right of Obsidian) turns to a warning colour; hover over it to see why.
- A failed update never empties your bibliography.
- The plugin never edits your notes by itself.

## Commands

Open the command palette (`Ctrl/Cmd + P`):

- **Show reference list**: opens the sidebar with the references of the current note.
- **Refresh bibliography**: check Zotero (or re-read the bibliography file) right now. The same action is in the `@` status bar menu.
- **Rebuild Zotero cache**: delete the cache and import the whole library again. Use this if something looks wrong.

## Troubleshooting

**"No citation found for ..."**
1. Is the key spelled exactly like the Citation Key in Zotero?
2. Is Zotero running, with **Allow other applications on this computer to communicate with Zotero** turned on?
3. Run **Refresh bibliography**. If it still fails, run **Rebuild Zotero cache**.
4. Check that the reference really has a Citation Key in Zotero.

**The sidebar says it cannot connect to Zotero.** Start Zotero. The plugin reconnects by itself.

## Install

This fork is not in the community plugin list. Either:

- **BRAT:** install the *BRAT* plugin, then add `JuanTejedor/better-pandoc-reference-list`.
- **Manually:** download `main.js`, `manifest.json` and `styles.css` from a release into `<your vault>/.obsidian/plugins/better-pandoc-reference-list/`, then enable the plugin.

Pandoc must be installed ([pandoc.org](https://pandoc.org/), version 2.11 or newer), because the plugin uses it to read bibliography files.

If you had the original *Pandoc Reference List* installed, **turn it off first**: running both would format every citation twice. Settings are not shared between the two, so copy your choices over once.

## Development

```
npm install --legacy-peer-deps
npm run build        # production bundle -> main.js
npm run dev          # watch mode
npm test
npm run check-types
```

The Zotero tests run against a fake Zotero server, so they need neither Zotero nor network access.

## Credits and license

Based on [obsidian-pandoc-reference-list](https://github.com/mgmeyers/obsidian-pandoc-reference-list) by Matthew Meyers, released under the GNU GPL v3. This fork keeps that license. Several fixes were inspired by pull requests from that repository's contributors, credited in [docs/TRIAGE.md](docs/TRIAGE.md).

<img src="https://raw.githubusercontent.com/mgmeyers/obsidian-pandoc-reference-list/main/Screen%20Shot.png" alt="A screenshot of the plugin's works cited list">
