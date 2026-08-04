# dom-miner

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   ██████╗ ███████╗██╗   ██╗    ██████╗ ██╗  ██╗██████╗   ║
║   ██╔══██╗██╔════╝██║   ██║    ██╔══██╗██║  ██║██╔══██╗  ║
║   ██║  ██║█████╗  ██║   ██║    ██████╔╝███████║██████╔╝  ║
║   ██║  ██║██╔══╝  ╚██╗ ██╔╝    ██╔═══╝ ██╔══██║██╔══██╗  ║
║   ██████╔╝███████╗ ╚████╔╝ ██╗ ██║     ██║  ██║██║  ██║  ║
║   ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝ ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝  ║
║                                                          ║
║              ┌─┐┌─┐┬┌┐┌┌─┐┌─┐┬─┐┌─┐                      ║
║              │ ┬├┤ │││││ ┬│ │├┬┘├┤                       ║
║              └─┘└─┘┴┘└┘└─┘└─┘┴└─└─┘                      ║
║                                                          ║
║      Zip any website into a compact, LLM-friendly          ║
║      DOM map for QA test plans and AI agents               ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**dom-miner** turns any website into a compact, structured DOM map — the perfect input for QA test-plan generation, AI agents, and test-case authoring. Skip the raw HTML noise. Get only the elements that matter, with numeric IDs, regions, and Playwright-ready locators.

## Quick Start

```bash
# 1. Install
npm i -D dom-miner

# 2. Initialize (npm scripts + gitignore)
npx dom-miner init

# 3. Install browsers
npx playwright-core install chromium

# 4. Explore a full site
npx dom-miner explore site --url https://example.com/ --top 40
```

## Explore Modes

| Mode | Command | When |
|------|---------|------|
| **site** | `dom-miner explore site --url <home> --top 40` | Full site via sitemap/crawl — scope your test plan |
| **page** | `dom-miner explore page --url <url>` | Single page dump — deep-dive one page |
| **urls** | `dom-miner explore urls --urls-file list.txt` | Explicit URL set — map a feature slice |

```bash
# Full sitemap explore
npx dom-miner explore site --url https://example.com/ --top 50

# Single page
npx dom-miner explore page --url https://example.com/about/ --stem example

# URL set from file
npx dom-miner explore urls --urls-file ./module-urls.txt --stem example

# URL set inline
npx dom-miner explore urls --stem example \
  --url https://example.com/super/ \
  --url https://example.com/investments/
```

## Sample Output

A compact tree looks like this — clean, scannable, and token-efficient:

```
Page map: Example Site - About
URL: https://example.com/about/
Nodes: text-holders 24, interactive 18 (visible 15, collapsed-nav 3)
────────────────────────────────────────────────────────────
[header]
  text:heading1 "About Us"
  text:p "We build software that matters."
  [1] link "Home" href=/
  [2] link "Products" href=/products

[nav]
  [3] button "Menu"
  [4] link "About" href=/about
  [5] link "Careers" href=/careers (collapsed)
  [6] link "Team" href=/about/team (collapsed)

[main]
  text:heading2 "Our Mission"
  text:p "To empower teams with tools that scale."
  [7] link "Read More" href=/mission
  [8] button "Contact Sales"
  [9] textbox "Email"

[footer]
  text:p "© 2024 Example Corp"
  [10] link "Privacy" href=/privacy
  [11] link "Terms" href=/terms
```

## SPA / CSR Sites

dom-miner reads the **live DOM** after Playwright navigation. For React/Vue/Angular apps:

```bash
# CSR/SPA mode with auto-settle + thin-shell retry
npx dom-miner explore site --url https://spa.example/ --spa --top 40
npx dom-miner explore page --url https://spa.example/dashboard --spa --ready "main" --with-deep
```

| Flag | Effect |
|------|--------|
| `--spa` | `load` wait, longer settle (≥3s), lazy scroll, thin-shell retry |
| `--ready <css>` | Wait until selector is visible before read |
| `--wait-until` | `commit` · `domcontentloaded` · `load` · `networkidle` |
| `--scroll` | Scroll page to trigger lazy/intersection-observer content |
| `--settle-ms` | Extra fixed delay after navigation |

Thin-shell auto-retry is **on by default** when the page looks empty after initial load.

## URL List File Formats (`--urls-file`)

| Extension | Format |
|-----------|--------|
| `.txt` | One URL per line (`#` comments OK) |
| `.csv` | `url` column or first column |
| `.json` | `string[]`, `{ urls: [...] }`, or dom-miner `urls-full.json` |

## Other Commands

| Command | What |
|---------|------|
| `dom-miner init` | Add npm scripts + gitignore to current repo |
| `dom-miner compact --url <u>` | Quick compact tree (stdout / `--out`) |
| `dom-miner deep --url <u>` | Quick deep inventory |
| `dom-miner benchmark --url <u>` | Compact vs deep metrics |
| `dom-miner read --url <u>` | Compact, deep, or both |

## Compact vs Deep

dom-miner offers two read depths from the **same browser session**:

| | Compact | Deep |
|---|---|---|
| **Purpose** | Test-plan scoping, multi-page mapping | TC authoring, codegen, locator healing |
| **Output** | Pruned tree with regions + numeric IDs | Full interactive JSON with all hidden nodes |
| **Tokens** | ~5–20× fewer than deep | Complete element inventory |
| **Locators** | Lightweight hints | Every element gets a Playwright locator |
| **Speed** | Fast read | Slower, but same browser state |

You don't need two browser stacks. One Playwright session → two read depths.

## Artifacts

```
data/dom-miner/<stem>/
├── manifest.json            ← Site-level summary
├── README.md                ← Human-readable page list
└── <pageId>/
    ├── compact.tree.txt     ← Agent-readable tree (the main output)
    ├── compact.json         ← Structured compact data
    ├── deep.json            ← Full inventory (if --with-deep)
    └── observe-meta.json    ← Timing, tokens, metrics

test-output/sitemap/<stem>-urls-full.json  ← Full URL inventory
```

## Cloudflare / Bot Walls

When a page is blocked (Cloudflare challenge, bot detection):
- Evidence dump is kept for debugging
- Page is marked `blocked` in `manifest.json`
- Excluded from `pageCount` and token totals
- Expand is skipped (clicks won't help behind a wall)

## Library API

```ts
import {
  discoverSiteUrls,
  dumpPagesToData,
  loadUrlsFromFile,
  runCompactObserve,
  runDeepInventory,
} from 'dom-miner';
```

| Export | Use |
|--------|-----|
| `discoverSiteUrls(homeUrl, opts)` | Sitemap discovery + ranking |
| `dumpPagesToData({ root, stem, urls, ... })` | Batch page dump loop |
| `runCompactObserve(page)` | Compact DOM read |
| `runDeepInventory(page)` | Deep inventory read |
| `loadUrlsFromFile(path)` | Parse .txt / .csv / .json URL lists |
| `stemFromUrl(url)` | Derive output folder name from URL |
| `pageIdFromUrl(url)` | Derive page directory name from URL |
| `sanitizeStem(str)` | Sanitize user-supplied stem |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `MINE_URL` | Default `--url` |
| `TEST_BASE_URL` | Fallback default `--url` |
| `DOM_MINER_ROOT` | Force project root (default: walk-up from cwd) |

## Develop

```bash
npm install
npm run build
npm test        # 35 tests, zero dependencies
```

TypeScript source in `src/`, compiled to `dist/`. Library entry at `src/index.ts`, CLI entry at `src/cli.ts`.

## License

MIT
