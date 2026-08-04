/**
 * Public library entry for dom-miner.
 * Prefer the CLI for site-map / dump; import these when embedding in other tools.
 */
export { findRepoRoot } from './lib/root.js';
export { estimateTokens, byteLength, summarizeCompact, summarizeDeep } from './lib/metrics.js';
export { stemFromUrl, discoverSiteUrls, slugFromUrl, sanitizeStem, sameOrigin, sortAndRank } from './lib/discover-urls.js';
export { dumpPagesToData, pageIdFromUrl } from './lib/dump-pages.js';
export { runCompactObserve, formatCompactTree } from './lib/compact-observe.js';
export { runDeepInventory } from './lib/deep-inventory.js';
export { expandUi } from './lib/expand-ui.js';
export { settlePage, probePageRichness, isThinShell, scrollPageForLazy, detectInterstitialPage } from './lib/settle-page.js';
export { loadUrlsFromFile } from './lib/parse-url-list.js';
