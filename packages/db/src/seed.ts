/**
 * Seeds the Iowa Liquor Sales model: the port of the MVP's schema.py.
 *
 * The curated parts — the per-column notes and the display labels — are the
 * MVP's most valuable asset, because they are what make the generated DAX
 * correct. Introspection can rediscover names and types; it cannot rediscover
 * "this is the only summable column" or "never ORDER BY this in a monthly
 * grouping". Re-introspection must preserve them.
 */
import { eq } from 'drizzle-orm';
import { createDatabase } from './client.js';
import { encryptSecret } from './crypto.js';
import * as schema from './schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
const DATASET_SECRET_KEY = process.env.DATASET_SECRET_KEY;

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
if (!DATASET_SECRET_KEY) throw new Error('DATASET_SECRET_KEY is not set');

type Column = {
  name: string;
  dataType: string;
  sampleValue: string | null;
  isAggregatable?: boolean;
  note?: string;
  labels?: { es?: string; en?: string };
};

const TABLES: {
  name: string;
  role: 'fact' | 'dimension' | 'date';
  description: string;
  columns: Column[];
}[] = [
  {
    name: 'Calendar',
    role: 'date',
    description: 'Tabla de calendario. Toda dimensión temporal sale de aquí.',
    columns: [
      {
        name: 'Date',
        dataType: 'datetime',
        sampleValue: '2012-07-02',
        labels: { es: 'Fecha', en: 'Date' },
      },
      {
        name: 'FechaSK',
        dataType: 'entero',
        sampleValue: '20120702',
        note: 'Clave subrogada AAAAMMDD. NO usar en ORDER BY: en agrupaciones mensuales hay N valores por grupo y Power BI falla. Usa Año#Mes para ordenar.',
      },
      {
        name: '#Año',
        dataType: 'entero',
        sampleValue: '2012',
        note: "Filtrar por año SIN comillas: 'Calendar'[#Año] = 2016",
        labels: { es: 'Año', en: 'Year' },
      },
      {
        name: '#Trimestre',
        dataType: 'entero',
        sampleValue: '3',
        labels: { es: 'Trimestre', en: 'Quarter' },
      },
      { name: '#Mes', dataType: 'entero', sampleValue: '7', labels: { es: 'Mes', en: 'Month' } },
      { name: '#Día', dataType: 'entero', sampleValue: '2', labels: { es: 'Día', en: 'Day' } },
      {
        name: 'Trimestre',
        dataType: 'texto',
        sampleValue: 'T3',
        labels: { es: 'Trimestre', en: 'Quarter' },
      },
      { name: 'Mes', dataType: 'texto', sampleValue: 'July', labels: { es: 'Mes', en: 'Month' } },
      {
        name: 'MesCorto',
        dataType: 'texto',
        sampleValue: 'Jul',
        labels: { es: 'Mes', en: 'Month' },
      },
      { name: '#DíaSemana', dataType: 'entero', sampleValue: '1' },
      { name: '#SemanaAño', dataType: 'entero', sampleValue: '28' },
      { name: 'CierreSemana', dataType: 'datetime', sampleValue: '2012-07-08' },
      { name: 'Día', dataType: 'texto', sampleValue: 'Monday' },
      { name: 'DíaCorto', dataType: 'texto', sampleValue: 'Mon' },
      { name: 'AñoTrimestre', dataType: 'texto', sampleValue: '2012/T3' },
      {
        name: 'Año#Mes',
        dataType: 'texto',
        sampleValue: '2012/07',
        note: 'Eje temporal para evolución mensual. Ordenable por texto (año primero).',
        labels: { es: 'Año/Mes', en: 'Year/Month' },
      },
      {
        name: 'AñoMesCorto',
        dataType: 'texto',
        sampleValue: '2012/Jul',
        note: 'Etiqueta legible para evolución mensual.',
        labels: { es: 'Mes', en: 'Month' },
      },
    ],
  },
  {
    name: 'Invoices',
    role: 'fact',
    description: 'Tabla de hechos. Una fila por línea de factura. Es la tabla grande del modelo.',
    columns: [
      {
        name: 'Invoice',
        dataType: 'texto',
        sampleValue: 'S04591900003',
        labels: { es: 'Factura', en: 'Invoice' },
      },
      {
        name: 'Date',
        dataType: 'datetime',
        sampleValue: '2012-03-15',
        note: 'Relacionada con Calendar[Date]. Filtrar fechas vía Calendar.',
        labels: { es: 'Fecha factura', en: 'Invoice date' },
      },
      { name: 'Store Number', dataType: 'entero', sampleValue: '2190' },
      { name: 'Item Number', dataType: 'entero', sampleValue: '31657' },
      {
        name: 'Bottles Sold',
        dataType: 'entero',
        sampleValue: '12',
        isAggregatable: true,
        note: 'ÚNICA columna sumable del modelo. Toda métrica de ventas parte de aquí.',
        labels: { es: 'Botellas vendidas', en: 'Bottles sold' },
      },
    ],
  },
  {
    name: 'Items',
    role: 'dimension',
    description: 'Catálogo de productos.',
    columns: [
      { name: 'Item Number', dataType: 'entero', sampleValue: '678' },
      {
        name: 'Item Description',
        dataType: 'texto',
        sampleValue: 'Dewars 12 W/2 Rock Glasses',
        note: "Nombre del producto. 'producto' = esta columna.",
        labels: { es: 'Descripción', en: 'Description' },
      },
      {
        name: 'Category',
        dataType: 'entero',
        sampleValue: '1701100',
        note: "CÓDIGO de categoría. Para mostrar usa 'Category Name'.",
      },
      {
        name: 'Category Name',
        dataType: 'texto',
        sampleValue: 'Decanters & Specialty Packages',
        note: "Nombre legible de categoría. 'categoría' = esta columna.",
        labels: { es: 'Categoría', en: 'Category' },
      },
      { name: 'Category Group', dataType: 'texto', sampleValue: 'Other' },
      {
        name: 'Vendor Number',
        dataType: 'entero',
        sampleValue: '35',
        note: 'Identificador FIABLE del proveedor (Vendor Name tiene duplicados de texto).',
      },
      {
        name: 'Vendor Name',
        dataType: 'texto',
        sampleValue: 'Bacardi Usa Inc',
        note: "OJO: mismo proveedor puede aparecer con texto distinto ('Bacardi Usa Inc' vs 'Bacardi U.S.A., Inc.'). Para agrupar proveedor de forma exacta, preferir Vendor Number.",
        labels: { es: 'Proveedor', en: 'Vendor' },
      },
      { name: 'Pack', dataType: 'entero', sampleValue: '6' },
      { name: 'Bottle Volume (ml)', dataType: 'entero', sampleValue: '750' },
      {
        name: 'State Bottle Cost',
        dataType: 'decimal',
        sampleValue: '20.0',
        note: 'Precio COSTE UNITARIO. NO sumar. Para importes: precio * Bottles Sold.',
        labels: { es: 'Coste botella', en: 'Bottle cost' },
      },
      {
        name: 'State Bottle Retail',
        dataType: 'decimal',
        sampleValue: '30.0',
        note: 'Precio VENTA UNITARIO. NO sumar. Para facturación: Retail * Bottles Sold.',
        labels: { es: 'Precio retail', en: 'Retail price' },
      },
    ],
  },
  {
    name: 'Stores',
    role: 'dimension',
    description: 'Catálogo de tiendas.',
    columns: [
      { name: 'Store Number', dataType: 'entero', sampleValue: '5386' },
      {
        name: 'Store Name',
        dataType: 'texto',
        sampleValue: "Casey'S General Store # 2494",
        note: "'tienda' = esta columna.",
        labels: { es: 'Tienda', en: 'Store' },
      },
      { name: 'Store Short', dataType: 'texto', sampleValue: "Casey'S General Store" },
      {
        name: 'Address',
        dataType: 'texto',
        sampleValue: '200 S Commercial Ave',
        labels: { es: 'Dirección', en: 'Address' },
      },
      {
        name: 'City',
        dataType: 'texto',
        sampleValue: 'Eagle Grove',
        note: "'ciudad' = esta columna.",
        labels: { es: 'Ciudad', en: 'City' },
      },
      {
        name: 'County',
        dataType: 'texto',
        sampleValue: 'Wright',
        note: "'condado' = esta columna.",
        labels: { es: 'Condado', en: 'County' },
      },
      { name: 'County Number', dataType: 'entero', sampleValue: '99' },
      {
        name: 'Zip Code',
        dataType: 'entero',
        sampleValue: '50533',
        labels: { es: 'Código postal', en: 'Zip code' },
      },
      { name: 'Store Location', dataType: 'texto', sampleValue: 'POINT (-93.90 42.66)' },
      { name: 'Merged', dataType: 'texto', sampleValue: '200 S Commercial Ave, Eagle Grove' },
      { name: 'lat', dataType: 'decimal', sampleValue: '-93.90448' },
      { name: 'lon', dataType: 'decimal', sampleValue: '42.662672' },
    ],
  },
];

const MEASURES = [
  { name: 'Botellas vendidas', expression: "SUM('Invoices'[Bottles Sold])" },
  { name: 'Ventas', expression: "SUM('Invoices'[Bottles Sold])" },
  {
    name: 'Facturación',
    expression:
      "SUMX('Invoices', 'Invoices'[Bottles Sold] * RELATED('Items'[State Bottle Retail]))",
  },
  {
    name: 'Coste total',
    expression: "SUMX('Invoices', 'Invoices'[Bottles Sold] * RELATED('Items'[State Bottle Cost]))",
  },
  { name: 'Margen', expression: '[Facturación] - [Coste total]  (calcular ambos SUMX)' },
  { name: 'Precio medio venta', expression: "AVERAGE('Items'[State Bottle Retail])" },
  { name: 'Precio medio coste', expression: "AVERAGE('Items'[State Bottle Cost])" },
];

const RELATIONSHIPS = [
  { fromColumn: 'Invoices[Item Number]', toColumn: 'Items[Item Number]' },
  { fromColumn: 'Invoices[Store Number]', toColumn: 'Stores[Store Number]' },
  { fromColumn: 'Invoices[Date]', toColumn: 'Calendar[Date]' },
] as const;

const SYNONYMS = [
  { term: 'ventas', target: 'Botellas vendidas' },
  { term: 'vendido', target: 'Botellas vendidas' },
  { term: 'botellas', target: 'Botellas vendidas' },
  { term: 'facturación', target: 'Facturación' },
  { term: 'ingresos', target: 'Facturación' },
  { term: 'producto', target: 'Items[Item Description]' },
  { term: 'artículo', target: 'Items[Item Description]' },
  { term: 'categoría', target: 'Items[Category Name]' },
  { term: 'proveedor', target: 'Items[Vendor Name] (agrupar por Vendor Number si exactitud)' },
  {
    term: 'vendedor',
    target:
      'Items[Vendor Name] — proveedor/marca, NO la tienda. Si el usuario parece referirse al punto de venta, pedir aclaración.',
  },
  { term: 'marca', target: 'Items[Vendor Name]' },
  { term: 'tienda', target: 'Stores[Store Name]' },
  { term: 'ciudad', target: 'Stores[City]' },
  { term: 'condado', target: 'Stores[County]' },
  { term: 'mes', target: 'Calendar[Mes] / evolución: Calendar[Año#Mes]' },
  { term: 'año', target: 'Calendar[#Año]' },
  { term: 'trimestre', target: 'Calendar[#Trimestre]' },
];

async function main() {
  const db = createDatabase(DATABASE_URL as string);
  const name = 'Ventas de licores (Iowa Liquor Sales)';

  const existing = await db.query.datasets.findFirst({ where: eq(schema.datasets.name, name) });
  if (existing) {
    console.log(`Dataset "${name}" already seeded (${existing.id}).`);
    process.exit(0);
  }

  const [dataset] = await db
    .insert(schema.datasets)
    .values({
      name,
      description:
        'Ventas mayoristas de botellas de licor: cada factura registra botellas vendidas de un producto en una tienda en una fecha.',
      /*
       * Left blank on purpose. The connection belongs to the environment: the API
       * writes `PBI_*` into this row on every boot, so a value seeded here would
       * be overwritten and would only invite someone to edit the wrong place.
       */
      tenantId: '',
      clientId: '',
      clientSecretEncrypted: encryptSecret('', DATASET_SECRET_KEY as string),
      workspaceName: '',
      datasetName: '',
      dateMin: '2012-01-01',
      dateMax: '2021-12-31',
    })
    .returning();

  if (!dataset) throw new Error('Could not insert dataset');

  for (const table of TABLES) {
    const [row] = await db
      .insert(schema.datasetTables)
      .values({
        datasetId: dataset.id,
        name: table.name,
        role: table.role,
        description: table.description,
      })
      .returning();
    if (!row) throw new Error(`Could not insert table ${table.name}`);

    await db.insert(schema.datasetColumns).values(
      table.columns.map((column) => ({
        tableId: row.id,
        name: column.name,
        dataType: column.dataType,
        sampleValue: column.sampleValue,
        isAggregatable: column.isAggregatable ?? false,
        note: column.note ?? null,
        labels: column.labels ?? {},
      })),
    );
  }

  await db
    .insert(schema.datasetMeasures)
    .values(MEASURES.map((measure) => ({ datasetId: dataset.id, ...measure })));

  await db.insert(schema.datasetRelationships).values(
    RELATIONSHIPS.map((relationship) => ({
      datasetId: dataset.id,
      fromColumn: relationship.fromColumn,
      toColumn: relationship.toColumn,
      cardinality: '*:1' as const,
      isActive: true,
    })),
  );

  await db
    .insert(schema.datasetSynonyms)
    .values(SYNONYMS.map((synonym) => ({ datasetId: dataset.id, ...synonym })));

  const columns = TABLES.reduce((total, table) => total + table.columns.length, 0);
  console.log(
    `Seeded "${name}" (${dataset.id}): ${TABLES.length} tables, ${columns} columns, ` +
      `${MEASURES.length} measures, ${SYNONYMS.length} synonyms.`,
  );

  process.exit(0);
}

void main();
