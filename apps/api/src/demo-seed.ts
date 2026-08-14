/**
 * Populates a demo account with pre-built cards so the app can be shown without
 * live Power BI or OpenAI credentials.
 *
 * The numbers are invented but plausible; the card shapes are the real contract
 * shapes, so every renderer is exercised by genuine data rather than a mock.
 *
 *   pnpm --filter @powerbia/api demo
 */
import type { Card } from '@powerbia/contracts';
import { DEFAULT_WIDGET_SIZE } from '@powerbia/contracts';
import { createDatabase, schema } from '@powerbia/db';
import { eq } from 'drizzle-orm';
import { hashPassword } from './auth/passwords.js';
import { env } from './env.js';

const EMAIL = 'demo@unnic.ai';
const PASSWORD = 'demo-password-1234';

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const CATEGORIES = [
  'Whiskies canadienses',
  'Vodkas 80 proof',
  'Rones especiados',
  'Tequilas 100% agave',
  'Ginebras premium',
  'Whiskies escoceses',
  'Licores de crema',
  'Brandies importados',
];

/** Deterministic pseudo-random so the demo looks the same every run. */
function wobble(seed: number): number {
  return (Math.sin(seed * 12.9898) * 43758.5453) % 1;
}

function monthlySeries(base: number, growth: number, seed: number) {
  return MONTHS.map((label, index) => ({
    label,
    value: Math.round(base + growth * index + Math.abs(wobble(seed + index)) * base * 0.28),
  }));
}

const totalBottles: Card = {
  kind: 'kpi',
  title: 'Botellas vendidas (2021)',
  subtitle: null,
  value: 6_284_915,
  unit: 'botellas',
};

const revenue: Card = {
  kind: 'kpi',
  title: 'Facturación (2021)',
  subtitle: null,
  value: 128_476_320.5,
  unit: 'USD',
};

const topCategories: Card = {
  kind: 'bar',
  title: 'Top categorías por botellas vendidas (2021)',
  subtitle: 'Mostrando los 15 valores principales del eje.',
  series: [
    {
      name: null,
      data: CATEGORIES.map((label, index) => ({
        label,
        value: Math.round(980_000 - index * 96_000 + Math.abs(wobble(index)) * 70_000),
      })),
    },
  ],
};

const monthlyTrend: Card = {
  kind: 'line',
  title: 'Evolución de botellas vendidas (2021)',
  subtitle: null,
  series: [{ name: null, data: monthlySeries(420_000, 14_000, 3) }],
  showTrend: true,
};

const cumulative: Card = {
  kind: 'area',
  title: 'Facturación acumulada (2021)',
  subtitle: null,
  series: [
    {
      name: null,
      data: monthlySeries(9_800_000, 320_000, 11).reduce<{ label: string; value: number }[]>(
        (acc, point) => {
          const previous = acc.at(-1)?.value ?? 0;
          acc.push({ label: point.label, value: previous + point.value });
          return acc;
        },
        [],
      ),
    },
  ],
  showTrend: false,
};

const distribution: Card = {
  kind: 'pie',
  title: 'Distribución de ventas por categoría',
  subtitle: null,
  data: CATEGORIES.slice(0, 6).map((label, index) => ({
    label,
    value: Math.round(1_400_000 - index * 190_000 + Math.abs(wobble(index + 7)) * 120_000),
  })),
};

const byCategoryOverTime: Card = {
  kind: 'multi_line',
  title: 'Evolución por categoría (2021)',
  subtitle: 'Mostrando las 7 categorías principales; el resto agrupado en «Otros».',
  series: [...CATEGORIES.slice(0, 7), 'Otros'].map((name, index) => ({
    name,
    data: monthlySeries(120_000 - index * 12_000, 3_200, index * 5 + 1),
  })),
};

const yearOverYear: Card = {
  kind: 'grouped_bar',
  title: 'Botellas vendidas por mes: 2020 vs 2021',
  subtitle: null,
  series: [
    { name: '2020', data: monthlySeries(380_000, 9_000, 21) },
    { name: '2021', data: monthlySeries(430_000, 13_500, 31) },
  ],
};

const stacked: Card = {
  kind: 'stacked_bar',
  title: 'Composición de ventas por categoría y trimestre',
  subtitle: null,
  series: CATEGORIES.slice(0, 5).map((name, index) => ({
    name,
    data: ['T1', 'T2', 'T3', 'T4'].map((label, quarter) => ({
      label,
      value: Math.round(
        240_000 - index * 34_000 + quarter * 12_000 + Math.abs(wobble(index + quarter)) * 30_000,
      ),
    })),
  })),
};

const volumeAndPrice: Card = {
  kind: 'combo',
  title: 'Botellas vendidas y precio medio (2021)',
  subtitle: null,
  series: [
    {
      name: 'Botellas vendidas',
      type: 'bar',
      axis: 'primary',
      data: monthlySeries(430_000, 12_000, 41),
    },
    {
      name: 'Precio medio venta',
      type: 'line',
      axis: 'secondary',
      data: MONTHS.map((label, index) => ({
        label,
        value: Number((17.4 + index * 0.22 + Math.abs(wobble(index + 51)) * 1.6).toFixed(2)),
      })),
    },
  ],
};

const invoices: Card = {
  kind: 'table',
  title: 'Facturas recientes',
  subtitle: null,
  columns: [
    'Factura',
    'Fecha factura',
    'Tienda',
    'Categoría',
    'Botellas vendidas',
    'Precio retail',
  ],
  rows: Array.from({ length: 60 }, (_, index) => [
    `S${(4591900 + index * 37).toString()}`,
    `2021-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
    [
      "Casey'S General Store #2494",
      'Hy-Vee #3 / BDI / Des Moines',
      'Central City Liquor',
      'Wilkie Liquors',
    ][index % 4] as string,
    CATEGORIES[index % CATEGORIES.length] as string,
    Math.round(6 + Math.abs(wobble(index)) * 120),
    Number((9.75 + Math.abs(wobble(index + 3)) * 42).toFixed(2)),
  ]),
};

const storeFilter: Card = {
  kind: 'filter',
  title: 'Tienda',
  subtitle: null,
  table: 'Stores',
  column: 'Store Name',
  values: [
    'Central City Liquor',
    "Casey'S General Store #2494",
    'Fareway Stores #058',
    'Hy-Vee #3 / BDI / Des Moines',
    'Hy-Vee Food Store #5',
    'Kum & Go #521',
    'Sam’s Club 6344',
    'Wal-Mart 1546',
    'Wilkie Liquors',
  ],
  selected: ['Central City Liquor', 'Wilkie Liquors'],
};

const note: Card = {
  kind: 'note',
  title: '¿Qué puedes preguntar?',
  subtitle: null,
  text: 'Ventas por producto, categoría, proveedor, tienda, ciudad o condado, y evolución temporal entre 2012 y 2021. Pide un formato concreto ("en barras", "quesito", "compara 2020 y 2021") y lo respeta.',
};

/** [card, question that produced it] — the question makes the widget re-runnable. */
const WIDGETS: [Card, string | null][] = [
  [totalBottles, '¿Cuántas botellas se vendieron en 2021?'],
  [revenue, '¿Cuál fue la facturación total de 2021?'],
  [storeFilter, null],
  [monthlyTrend, 'Muéstrame la evolución de ventas en 2021 y su tendencia'],
  [topCategories, 'Top categorías por botellas vendidas en 2021'],
  [distribution, 'Distribución de ventas por categoría'],
  [byCategoryOverTime, 'Evolución de ventas por categoría en 2021'],
  [yearOverYear, 'Compara las botellas vendidas por mes entre 2020 y 2021'],
  [stacked, 'Composición de ventas por categoría y trimestre'],
  [volumeAndPrice, 'Combina botellas vendidas con el precio medio por mes'],
  [cumulative, 'Facturación acumulada durante 2021'],
  [invoices, 'Dame el listado de facturas recientes'],
  [note, null],
];

const CONVERSATIONS: { title: string; turns: [string, string, Card | null, string | null][] }[] = [
  {
    title: '¿Cuántas botellas se vendieron en 2021?',
    turns: [
      [
        '¿Cuántas botellas se vendieron en 2021?',
        'En 2021 se vendieron 6.284.915 botellas, un 11,4 % más que en 2020. El mejor mes fue diciembre.',
        totalBottles,
        `EVALUATE\nROW("Botellas vendidas", CALCULATE(SUM('Invoices'[Bottles Sold]), 'Calendar'[#Año] = 2021))`,
      ],
      [
        'Muéstrame la evolución mes a mes y su tendencia',
        'Aquí tienes la evolución mensual. La tendencia es claramente ascendente: el segundo semestre supera al primero en todos los meses comparables.',
        monthlyTrend,
        `EVALUATE\nCALCULATETABLE(\n    SUMMARIZECOLUMNS(\n        'Calendar'[Año#Mes],\n        'Calendar'[AñoMesCorto],\n        "Ventas", SUM('Invoices'[Bottles Sold])\n    ),\n    'Calendar'[#Año] = 2021\n)\nORDER BY 'Calendar'[Año#Mes] ASC`,
      ],
    ],
  },
  {
    title: 'Top categorías por botellas vendidas en 2021',
    turns: [
      [
        'Top categorías por botellas vendidas en 2021',
        'Los whiskies canadienses lideran con 1.02 M de botellas, seguidos de los vodkas 80 proof. Las cuatro primeras categorías concentran algo más de la mitad del volumen.',
        topCategories,
        `EVALUATE\nTOPN(\n    10,\n    CALCULATETABLE(\n        SUMMARIZECOLUMNS(\n            'Items'[Category Name],\n            "Ventas", SUM('Invoices'[Bottles Sold])\n        ),\n        'Calendar'[#Año] = 2021\n    ),\n    [Ventas], DESC\n)`,
      ],
      [
        'Ponlo en un quesito',
        'Aquí tienes la misma información como distribución.',
        distribution,
        `EVALUATE\nCALCULATETABLE(\n    SUMMARIZECOLUMNS(\n        'Items'[Category Name],\n        "Ventas", SUM('Invoices'[Bottles Sold])\n    ),\n    'Calendar'[#Año] = 2021\n)`,
      ],
    ],
  },
  {
    title: 'Compara el precio medio por mes entre 2020 y 2021',
    turns: [
      [
        'Compara las botellas vendidas por mes entre 2020 y 2021',
        '2021 supera a 2020 en todos los meses. La diferencia se abre a partir de junio y llega a su máximo en noviembre.',
        yearOverYear,
        `EVALUATE\nCALCULATETABLE(\n    SUMMARIZECOLUMNS(\n        'Calendar'[#Mes],\n        'Calendar'[Mes],\n        'Calendar'[#Año],\n        "Ventas", SUM('Invoices'[Bottles Sold])\n    ),\n    'Calendar'[#Año] IN {2020, 2021}\n)\nORDER BY 'Calendar'[#Mes] ASC, 'Calendar'[#Año] ASC`,
      ],
    ],
  },
];

async function main() {
  const db = createDatabase(env.DATABASE_URL);

  const dataset = await db.query.datasets.findFirst();
  if (!dataset) throw new Error('No dataset found — run `pnpm db:seed` first');

  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, EMAIL) });
  const user =
    existing ??
    (
      await db
        .insert(schema.users)
        .values({
          email: EMAIL,
          displayName: 'Demo',
          role: 'admin',
          passwordHash: await hashPassword(PASSWORD),
        })
        .returning()
    )[0];

  if (!user) throw new Error('Could not create the demo user');

  // Re-runnable: drop whatever the previous run made before rebuilding.
  await db.delete(schema.dashboards).where(eq(schema.dashboards.userId, user.id));
  await db.delete(schema.conversations).where(eq(schema.conversations.userId, user.id));

  const [dashboard] = await db
    .insert(schema.dashboards)
    .values({ userId: user.id, datasetId: dataset.id, name: 'Resumen Iowa Liquor Sales' })
    .returning();
  if (!dashboard) throw new Error('Could not create the dashboard');

  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const [card, query] of WIDGETS) {
    const size = DEFAULT_WIDGET_SIZE[card.kind];

    if (x + size.width > 12) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }

    await db.insert(schema.widgets).values({
      dashboardId: dashboard.id,
      card,
      query,
      x,
      y,
      width: size.width,
      height: size.height,
    });

    x += size.width;
    rowHeight = Math.max(rowHeight, size.height);
  }

  for (const conversation of CONVERSATIONS) {
    const [row] = await db
      .insert(schema.conversations)
      .values({ userId: user.id, datasetId: dataset.id, title: conversation.title })
      .returning();
    if (!row) continue;

    for (const [question, answer, card, dax] of conversation.turns) {
      await db
        .insert(schema.messages)
        .values({ conversationId: row.id, role: 'user', text: question });
      await db
        .insert(schema.messages)
        .values({ conversationId: row.id, role: 'assistant', text: answer, card, dax });
    }
  }

  console.log(`Demo ready.
  user:       ${EMAIL}
  password:   ${PASSWORD}
  dashboard:  "${dashboard.name}" with ${WIDGETS.length} widgets
  chats:      ${CONVERSATIONS.length}`);

  process.exit(0);
}

void main();
