import type { FilterSelection } from '@powerbia/contracts';

function toPredicate({ table, column, values }: FilterSelection): string {
  const literals = values.map((value) => `"${value.replace(/"/g, '""')}"`).join(', ');

  return `'${table}'[${column}] IN {${literals}}`;
}

/**
 * Wraps generated DAX in CALCULATETABLE so dashboard slicers are honoured
 * deterministically. The MVP appended the selections to the prompt as prose and
 * relied on the model to translate them, which it did not always do.
 */
export function applyFilters(dax: string, filters: readonly FilterSelection[]): string {
  if (filters.length === 0) return dax;

  const trimmed = dax.trim();
  const evaluateAt = trimmed.search(/\bEVALUATE\b/i);
  if (evaluateAt === -1) return trimmed;

  const headEnd = evaluateAt + 'EVALUATE'.length;
  const head = trimmed.slice(0, headEnd);
  const rest = trimmed.slice(headEnd);

  const orderBy = /\bORDER\s+BY\b/i.exec(rest);
  const body = (orderBy ? rest.slice(0, orderBy.index) : rest).trim();
  const tail = orderBy ? rest.slice(orderBy.index).trim() : '';

  const predicates = filters.map(toPredicate).join(',\n  ');
  const wrapped = `${head}\nCALCULATETABLE(\n  ${body},\n  ${predicates}\n)`;

  return tail ? `${wrapped}\n${tail}` : wrapped;
}
