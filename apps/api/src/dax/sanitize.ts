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
 *   -> EVALUATE ROW("Sales", CALCULATE(<expr>, FILTER(...)))
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

/**
 * Splits a call's arguments on the commas that are not inside nested brackets
 * or a string literal. `[Column]` is bracketed too, so it is tracked alongside
 * parentheses rather than assumed to be free of commas.
 */
function splitTopLevelArgs(input: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') quoted = false;
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      args.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }

  args.push(input.slice(start).trim());

  return args.filter((arg) => arg !== '');
}

/** Whitespace and case carry no meaning between two references to one measure. */
function normalizeExpression(expression: string): string {
  return expression.replace(/\s+/g, '').toLowerCase();
}

const COLUMN_REFERENCE = /^'[^']+'\[[^\]]+\]$|^[A-Za-z_][\w.]*\[[^\]]+\]$/;

const ORDER_TOKEN = new Map<string, 'ASC' | 'DESC'>([
  ['asc', 'ASC'],
  ['true', 'ASC'],
  ['true()', 'ASC'],
  ['1', 'ASC'],
  ['desc', 'DESC'],
  ['false', 'DESC'],
  ['false()', 'DESC'],
  ['0', 'DESC'],
]);

/**
 * Maps every expression the wrapped table exposes as a result column onto the
 * name `ORDER BY` has to use. A `SUMMARIZECOLUMNS` measure is projected under
 * its alias, so ordering by the measure it wraps only works if the alias is
 * substituted back in - and if the shape is anything else, there is nothing to
 * prove the reference resolves, which is the caller's cue to leave it alone.
 */
function resultColumnsOf(table: string): Map<string, string> | null {
  const match = /^SUMMARIZECOLUMNS\s*\(([\s\S]*)\)$/i.exec(table.trim());
  if (!match?.[1]) return null;

  const args = splitTopLevelArgs(match[1]);
  const columns = new Map<string, string>();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;

    if (COLUMN_REFERENCE.test(arg)) {
      columns.set(normalizeExpression(arg), arg);
      continue;
    }

    const alias = /^"([^"]+)"$/.exec(arg);
    const expression = args[i + 1];
    if (alias?.[1] && expression) {
      columns.set(normalizeExpression(expression), `[${alias[1]}]`);
      columns.set(normalizeExpression(`[${alias[1]}]`), `[${alias[1]}]`);
      i += 1;
    }
  }

  return columns.size > 0 ? columns : null;
}

/**
 * `TOPN` picks the right rows and says nothing about the order they come back
 * in, so "los 15 articulos con mas kilos" rendered as an unordered table while
 * the prose described a ranking. The generator is inconsistent about adding the
 * `ORDER BY`, so it is added here instead - but only when the ordering
 * expression can be shown to exist in the result, since an `ORDER BY` naming a
 * column that is not projected turns a working query into an error.
 */
export function ensureTopnOrdering(dax: string): string {
  const trimmed = dax.trim();
  if (/\bORDER\s+BY\b/i.test(trimmed)) return dax;

  const match = /^EVALUATE\s+TOPN\s*\(([\s\S]*)\)$/i.exec(trimmed);
  if (!match?.[1]) return dax;

  const args = splitTopLevelArgs(match[1]);
  if (args.length < 3) return dax;

  const columns = resultColumnsOf(args[1] as string);
  if (!columns) return dax;

  const terms: string[] = [];
  for (let i = 2; i < args.length; i += 1) {
    const expression = columns.get(normalizeExpression(args[i] as string));
    if (!expression) return dax;

    const direction = ORDER_TOKEN.get(normalizeExpression(args[i + 1] ?? ''));
    if (direction) i += 1;

    terms.push(`${expression} ${direction ?? 'DESC'}`);
  }

  return terms.length > 0 ? `${trimmed}\nORDER BY ${terms.join(', ')}` : dax;
}

export function cleanGeneratedDax(raw: string): string {
  return ensureTopnOrdering(patchMeasureOnlySummarize(stripCodeFences(raw)));
}
