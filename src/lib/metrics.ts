/** Rough LLM token estimate (chars/4). Good enough for relative comparisons. */
export function estimateTokens(text: unknown): number {
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  return Math.ceil(s.length / 4);
}

export function byteLength(text: unknown): number {
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  return Buffer.byteLength(s, 'utf8');
}

export function summarizeDeep(deep: {
  elementCount?: number;
  visibleCount?: number;
  hiddenCount?: number;
  anchorCount?: number;
  buttonCount?: number;
  elements?: Array<{ playwrightLocator?: string }>;
}): Record<string, unknown> {
  return {
    elementCount: deep.elementCount,
    visibleCount: deep.visibleCount,
    hiddenCount: deep.hiddenCount,
    anchorCount: deep.anchorCount,
    buttonCount: deep.buttonCount,
    withLocator: (deep.elements || []).filter((e) => e.playwrightLocator).length,
  };
}

export function summarizeCompact(compact: {
  interactableCount?: number;
  textHolderCount?: number;
  headings?: unknown[];
  visibleCount?: number;
  interactables?: Array<{ collapsed?: boolean; playwrightLocator?: string; region?: string }>;
  collapsedNavCount?: number;
  headingCount?: number;
  textHolders?: Array<{ region?: string }>;
}): Record<string, unknown> {
  return {
    interactableCount: compact.interactableCount,
    textHolderCount: compact.textHolderCount ?? compact.headings?.length ?? 0,
    visibleCount: compact.visibleCount ?? compact.interactables?.filter((i) => !i.collapsed).length,
    collapsedNavCount:
      compact.collapsedNavCount ?? compact.interactables?.filter((i) => i.collapsed).length ?? 0,
    headingCount: compact.headingCount,
    withLocator: (compact.interactables || []).filter((e) => e.playwrightLocator).length,
    regions: [
      ...new Set([
        ...(compact.interactables || []).map((e) => e.region),
        ...(compact.textHolders || []).map((e) => e.region),
      ]),
    ],
  };
}
