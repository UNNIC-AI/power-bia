/**
 * Physical columns come back as `Calendar[Año#Mes]`; measure aliases from
 * SUMMARIZECOLUMNS come back bare and must pass through untouched.
 */
export function normalizeColumnName(name: string): string {
  const open = name.lastIndexOf('[');
  if (open === -1) return name;

  return name.slice(open + 1).replace(/]$/, '');
}

export function normalizeColumnNames(names: readonly string[]): string[] {
  return names.map(normalizeColumnName);
}

/** Matches a declared alias like `Calendar[Año#Mes]` against a result column. */
export function resolveColumn(
  declared: string | null | undefined,
  columns: readonly string[],
): string | null {
  if (!declared) return null;

  const target = normalizeColumnName(declared).trim().toLowerCase();

  return columns.find((c) => normalizeColumnName(c).trim().toLowerCase() === target) ?? null;
}
