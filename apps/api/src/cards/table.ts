export type Cell = string | number | boolean | null;

export interface ResultTable {
  columns: string[];
  rows: Cell[][];
}

export function isEmpty(table: ResultTable): boolean {
  return table.rows.length === 0 || table.columns.length === 0;
}

export function columnIndex(table: ResultTable, name: string): number {
  return table.columns.indexOf(name);
}

export function cellAt(table: ResultTable, row: number, column: string): Cell {
  const index = columnIndex(table, column);
  if (index === -1) return null;

  return table.rows[row]?.[index] ?? null;
}

export function columnValues(table: ResultTable, name: string): Cell[] {
  const index = columnIndex(table, name);
  if (index === -1) return [];

  return table.rows.map((row) => row[index] ?? null);
}

export function isNumericColumn(table: ResultTable, name: string): boolean {
  const values = columnValues(table, name).filter((v) => v !== null);
  if (values.length === 0) return false;

  return values.every((v) => typeof v === 'number');
}

export function numericColumns(table: ResultTable): string[] {
  return table.columns.filter((c) => isNumericColumn(table, c));
}

export function categoricalColumns(table: ResultTable): string[] {
  return table.columns.filter((c) => !isNumericColumn(table, c));
}

export function toNumber(value: Cell): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function toLabel(value: Cell): string {
  return value === null ? '' : String(value);
}

/** Distinct values in first-seen order, which for a sorted query is chronological. */
export function distinctLabels(table: ResultTable, column: string): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const value of columnValues(table, column)) {
    const label = toLabel(value);
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }

  return labels;
}

export function sumByLabel(
  table: ResultTable,
  labelColumn: string,
  valueColumn: string,
): Map<string, number> {
  const labelIndex = columnIndex(table, labelColumn);
  const valueIndex = columnIndex(table, valueColumn);
  const totals = new Map<string, number>();

  if (labelIndex === -1 || valueIndex === -1) return totals;

  for (const row of table.rows) {
    const label = toLabel(row[labelIndex] ?? null);
    totals.set(label, (totals.get(label) ?? 0) + toNumber(row[valueIndex] ?? null));
  }

  return totals;
}

export function keepLabels(table: ResultTable, column: string, allowed: Set<string>): ResultTable {
  const index = columnIndex(table, column);
  if (index === -1) return table;

  return {
    columns: table.columns,
    rows: table.rows.filter((row) => allowed.has(toLabel(row[index] ?? null))),
  };
}
