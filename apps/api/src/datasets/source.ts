/**
 * What Power BI model the app talks to, as a value.
 *
 * Deliberately free of `../env.js`: the environment is read in ./provision.ts,
 * which is what makes this pair testable without a fully populated environment.
 */
export interface PowerBiSource {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  workspaceName: string;
  datasetName: string;
  /** What the UI calls the model. Falls back to the Power BI dataset name. */
  modelName: string;
}

/**
 * Whether a stored row points at a different model than a given source - the one
 * decision in provisioning that throws data away, so it lives here and is tested.
 *
 * An empty stored source means the row was seeded and never connected: there is
 * nothing stale to discard, and the catalogue it carries may well be the curated
 * one the seed wrote for this very model. A different non-empty source means
 * every table, column, measure and synonym in the catalogue describes some other
 * model, and keeping any of it would feed the pipeline lies.
 */
export function pointsElsewhere(
  stored: { workspaceName: string; datasetName: string },
  source: { workspaceName: string; datasetName: string },
): boolean {
  if (stored.workspaceName === '' || stored.datasetName === '') return false;

  return stored.workspaceName !== source.workspaceName || stored.datasetName !== source.datasetName;
}

/**
 * Which stored row is the app's one model.
 *
 * There is exactly one source and it is the environment, so this is not a
 * choice the app makes - it is the rule for finding the row the environment
 * already describes. Rows are expected in creation order.
 *
 * A row matching the environment wins. Otherwise the oldest row is reused, which
 * is what turns a source change into a repoint rather than an orphan: see
 * `provisionDatasetFromEnv`. With no source configured at all (demo mode) the
 * oldest row is all there is.
 */
export function selectActiveRow<T extends { workspaceName: string; datasetName: string }>(
  rows: readonly T[],
  source: { workspaceName: string; datasetName: string } | null,
): T | undefined {
  if (!source) return rows[0];

  return (
    rows.find(
      (row) => row.workspaceName === source.workspaceName && row.datasetName === source.datasetName,
    ) ?? rows[0]
  );
}
