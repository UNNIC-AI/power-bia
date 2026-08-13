export function stripCodeFences(text: string): string {
  return text
    .replace(/```(?:dax)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

/**
 * SUMMARIZECOLUMNS requires a grouping column as its first argument, but the
 * model regularly emits a measure there instead:
 *
 *   SUMMARIZECOLUMNS("Sales", <expr>, FILTER(...))
 *   → EVALUATE ROW("Sales", CALCULATE(<expr>, FILTER(...)))
 *
 * Fixing it here avoids a round trip through the repair stage.
 */
export function patchMeasureOnlySummarize(dax: string): string {
  const match = /^(?:EVALUATE\s+)?SUMMARIZECOLUMNS\s*\(\s*"([^"]+)"\s*,\s*([\s\S]+)\)\s*$/i.exec(
    dax.trim(),
  );
  if (!match) return dax;

  const [, alias, rest] = match;
  if (!alias || !rest) return dax;

  const trailingFilter = /,\s*(FILTER\s*\([\s\S]+\))\s*$/i.exec(rest);
  if (trailingFilter?.[1]) {
    const expression = rest.slice(0, trailingFilter.index).replace(/,\s*$/, '').trim();
    return `EVALUATE\nROW("${alias}", CALCULATE(${expression}, ${trailingFilter[1].trim()}))`;
  }

  return `EVALUATE\nROW("${alias}", ${rest.trim()})`;
}

export function cleanGeneratedDax(raw: string): string {
  return patchMeasureOnlySummarize(stripCodeFences(raw));
}
