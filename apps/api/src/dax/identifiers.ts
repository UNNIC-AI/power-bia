/**
 * Model names come from the customer's model, not from us, so they can contain
 * the very characters that delimit a DAX identifier. Escaping them is what keeps
 * a table called `Ventas 'B'` from truncating the query it appears in.
 */

export function quoteTableName(table: string): string {
  return `'${table.replaceAll("'", "''")}'`;
}

export function quoteColumnRef(table: string, column: string): string {
  return `${quoteTableName(table)}[${column.replaceAll(']', ']]')}]`;
}

/** Alias of a projected column, for `SELECTCOLUMNS` and `ROW`. */
export function quoteAlias(alias: string): string {
  return `"${alias.replaceAll('"', '""')}"`;
}
