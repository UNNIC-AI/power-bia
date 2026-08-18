/**
 * Points an existing dataset row at the Power BI connection in PBI_*.
 *
 * The seed reads PBI_* once and writes it into the `datasets` row, so editing
 * the environment afterwards has no effect. This applies the change without
 * dropping the conversations and dashboards a re-seed would take with it.
 *
 *   pnpm --filter @powerbia/db connection            # the only dataset
 *   pnpm --filter @powerbia/db connection "<name>"   # a specific one
 */
import { eq } from 'drizzle-orm';
import { createDatabase } from './client.js';
import { encryptSecret } from './crypto.js';
import * as schema from './schema.js';

const required = [
  'DATABASE_URL',
  'DATASET_SECRET_KEY',
  'PBI_TENANT_ID',
  'PBI_CLIENT_ID',
  'PBI_CLIENT_SECRET',
  'PBI_WORKSPACE_NAME',
  'PBI_DATASET_NAME',
] as const;

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) throw new Error(`Missing: ${missing.join(', ')}`);

const db = createDatabase(process.env.DATABASE_URL as string);
const wanted = process.argv[2];

const datasets = await db.query.datasets.findMany();
const dataset = wanted ? datasets.find((d) => d.name === wanted) : datasets[0];

if (!dataset) {
  throw new Error(
    wanted
      ? `No dataset named "${wanted}". Found: ${datasets.map((d) => d.name).join(', ') || '(none)'}`
      : 'No datasets found — run `pnpm db:seed` first',
  );
}

if (!wanted && datasets.length > 1) {
  throw new Error(
    `${datasets.length} datasets exist; name the one to update: ${datasets.map((d) => `"${d.name}"`).join(', ')}`,
  );
}

await db
  .update(schema.datasets)
  .set({
    tenantId: process.env.PBI_TENANT_ID as string,
    clientId: process.env.PBI_CLIENT_ID as string,
    clientSecretEncrypted: encryptSecret(
      process.env.PBI_CLIENT_SECRET as string,
      process.env.DATASET_SECRET_KEY as string,
    ),
    workspaceName: process.env.PBI_WORKSPACE_NAME as string,
    datasetName: process.env.PBI_DATASET_NAME as string,
  })
  .where(eq(schema.datasets.id, dataset.id));

console.log(`Updated "${dataset.name}" (${dataset.id}):
  workspace: ${process.env.PBI_WORKSPACE_NAME}
  dataset:   ${process.env.PBI_DATASET_NAME}
  client:    ${process.env.PBI_CLIENT_ID}
  secret:    re-encrypted (${(process.env.PBI_CLIENT_SECRET as string).length} chars)`);

process.exit(0);
