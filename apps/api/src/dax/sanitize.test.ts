import { describe, expect, it } from 'vitest';
import { cleanGeneratedDax, ensureTopnOrdering } from './sanitize.js';

const topn = (body: string) => `EVALUATE\nTOPN(\n${body}\n)`;

describe('ensureTopnOrdering', () => {
  it('orders by the alias the measure is projected under', () => {
    const dax = topn(`    15,
    SUMMARIZECOLUMNS(
        dim_Articulo[CodigoArticulo],
        dim_Articulo[DescripcionArticulo],
        "Kilos fabricados", [Total Kgs Fabricados operarios]
    ),
    [Total Kgs Fabricados operarios],
    DESC`);

    expect(ensureTopnOrdering(dax)).toContain('ORDER BY [Kilos fabricados] DESC');
  });

  it('keeps a grouping column as written', () => {
    const dax = topn(`    5,
    SUMMARIZECOLUMNS('dim_Sección'[Seccion_Desc_Visualizar], "Unidades", [Total]),
    'dim_Sección'[Seccion_Desc_Visualizar],
    ASC`);

    expect(ensureTopnOrdering(dax)).toContain(
      "ORDER BY 'dim_Sección'[Seccion_Desc_Visualizar] ASC",
    );
  });

  it('reads 0 and 1 as DESC and ASC', () => {
    const dax = topn(`    10,
    SUMMARIZECOLUMNS(dim_Operario[NombreOperario], "Unidades", [Total unidades]),
    [Total unidades],
    0`);

    expect(ensureTopnOrdering(dax)).toContain('ORDER BY [Unidades] DESC');
  });

  it('defaults to DESC when the order argument is omitted', () => {
    const dax = topn(`    10,
    SUMMARIZECOLUMNS(dim_Operario[NombreOperario], "Unidades", [Total unidades]),
    [Total unidades]`);

    expect(ensureTopnOrdering(dax)).toContain('ORDER BY [Unidades] DESC');
  });

  it('leaves an existing ORDER BY alone', () => {
    const dax = `${topn(`    10,
    SUMMARIZECOLUMNS(dim_Operario[NombreOperario], "Unidades", [Total unidades]),
    [Total unidades],
    DESC`)}\nORDER BY [Unidades] ASC`;

    expect(ensureTopnOrdering(dax)).toBe(dax);
  });

  /*
   * An ORDER BY naming a column the query does not project is a hard error, so
   * anything that cannot be resolved has to come back untouched.
   */
  it('adds nothing when the ordering expression is not in the result', () => {
    const dax = topn(`    10,
    SUMMARIZECOLUMNS(dim_Operario[NombreOperario], "Unidades", [Total unidades]),
    [Total kilos],
    DESC`);

    expect(ensureTopnOrdering(dax)).toBe(dax);
  });

  it('adds nothing when the wrapped table is not a SUMMARIZECOLUMNS', () => {
    const dax = topn(`    10,
    ALL(dim_Operario),
    dim_Operario[NombreOperario],
    ASC`);

    expect(ensureTopnOrdering(dax)).toBe(dax);
  });

  it('leaves a query that does not start with TOPN alone', () => {
    const dax = 'EVALUATE\nSUMMARIZECOLUMNS(dim_Operario[NombreOperario], "Unidades", [Total])';

    expect(ensureTopnOrdering(dax)).toBe(dax);
  });

  it('runs as part of the generated-DAX cleanup', () => {
    const raw = `\`\`\`dax\n${topn(`    3,
    SUMMARIZECOLUMNS(dim_Articulo[CodigoArticulo], "Kilos", [Total Kgs]),
    [Total Kgs],
    DESC`)}\n\`\`\``;

    expect(cleanGeneratedDax(raw)).toContain('ORDER BY [Kilos] DESC');
  });
});
