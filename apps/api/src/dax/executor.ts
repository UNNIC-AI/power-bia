import type { DaxResult } from '@powerbia/contracts';
import { normalizeColumnNames } from './columns.js';

export interface PowerBiConnection {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  workspaceName: string;
  datasetName: string;
}

export type DaxOutcome = { ok: true; result: DaxResult } | { ok: false; error: string };

export interface DaxExecutor {
  execute(connection: PowerBiConnection, dax: string): Promise<DaxOutcome>;
  /** Whether the gateway answers at all. Read by `/readyz`; never throws. */
  health(): Promise<boolean>;
}

const HEALTH_TIMEOUT_MS = 2_000;

const DEFAULT_TIMEOUT_MS = 120_000;

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Talks to services/dax-gateway, which wraps ADOMD.NET over the XMLA endpoint.
 * Column names are normalised here rather than in the gateway so any future
 * executor shares the same behaviour.
 */
export function createGatewayExecutor(baseUrl: string, token: string): DaxExecutor {
  return {
    async execute(connection, dax) {
      try {
        const response = await fetch(new URL('/query', baseUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ connection, dax }),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });

        const payload = (await response.json()) as Partial<DaxResult> & { error?: string };

        if (!response.ok) {
          return { ok: false, error: payload.error ?? `gateway responded ${response.status}` };
        }

        return {
          ok: true,
          result: {
            columns: normalizeColumnNames(payload.columns ?? []),
            rows: payload.rows ?? [],
            durationMs: payload.durationMs ?? 0,
          },
        };
      } catch (cause) {
        return { ok: false, error: toMessage(cause) };
      }
    },

    async health() {
      try {
        const response = await fetch(new URL('/health', baseUrl), {
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });

        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
