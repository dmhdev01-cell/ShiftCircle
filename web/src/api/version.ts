/**
 * Build information from `GET /api/v1/version`.
 *
 * The response shape is the api's `VersionResponse` record
 * (`api/shiftcircle-api/.../version/VersionResponse.java`):
 * `{ name, version, buildTime, gitCommit, ruleSetVersion, profiles }`.
 * The field names are read exactly as the api sends them. If the api answers
 * with a different shape the reader keeps the raw payload so the screen can
 * show it, rather than showing a blank.
 */

export interface VersionInfo {
  /** Application name, e.g. `shiftcircle-api`. */
  name?: string;
  /** Build version, or `dev` when the api runs without build info. */
  version?: string;
  /** Build timestamp, or `unknown`. */
  buildTime?: string;
  /** Git commit the image was built from, or `unknown`. */
  gitCommit?: string;
  /** Published rule-set version the rules engine is running. */
  ruleSetVersion?: string;
  /** Active Spring profiles, comma separated. */
  profiles?: string;
  /** The server's "today" (`SC_DEMO_TODAY` on the demo profile). */
  asOf?: string;
  /** True only on the demo profile: the reset control may be offered. */
  demoMode?: boolean;
  /** The datasets the reset may generate, when the api names more than one. */
  datasets?: { id: string; name: string }[];
  /** The dataset the database holds now ("100", "120", "150"), when the api says. */
  activeDataset?: string;
  /** The raw response body, kept so unexpected shapes can be shown as-is. */
  raw: unknown;
}

export const VERSION_ENDPOINT = '/api/v1/version';

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

/** Read the fields the api's VersionResponse sends. */
export function normaliseVersion(raw: unknown): VersionInfo {
  if (typeof raw !== 'object' || raw === null) {
    return { raw };
  }
  const source = raw as Record<string, unknown>;

  return {
    name: asString(source.name),
    version: asString(source.version),
    buildTime: asString(source.buildTime),
    gitCommit: asString(source.gitCommit),
    ruleSetVersion: asString(source.ruleSetVersion),
    profiles: asString(source.profiles),
    asOf: asString(source.asOf),
    demoMode: source.demoMode === true,
    datasets: normaliseDatasets(source.datasets),
    activeDataset: asString(source.activeDataset),
    raw,
  };
}

/**
 * The datasets a reset may generate. The api may send plain ids or objects with
 * an id and a name; the screen shows the names it is given and never invents
 * one. Anything else is ignored, so an older api simply has no selector.
 */
function normaliseDatasets(value: unknown): { id: string; name: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .map((entry) => {
      if (typeof entry === 'string') return { id: entry, name: entry };
      if (typeof entry === 'object' && entry !== null) {
        const source = entry as Record<string, unknown>;
        const id = asString(source.id);
        if (!id) return null;
        return { id, name: asString(source.name) ?? asString(source.label) ?? id };
      }
      return null;
    })
    .filter((entry): entry is { id: string; name: string } => entry !== null);
  return rows.length > 0 ? rows : undefined;
}

/** True when the body carried none of the fields we know how to show. */
export function isKnownVersionShape(info: VersionInfo): boolean {
  return (
    info.name !== undefined ||
    info.version !== undefined ||
    info.buildTime !== undefined ||
    info.gitCommit !== undefined ||
    info.ruleSetVersion !== undefined ||
    info.profiles !== undefined
  );
}

export class VersionError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'VersionError';
    this.status = status;
  }
}

export async function fetchVersion(signal?: AbortSignal): Promise<VersionInfo> {
  let response: Response;
  try {
    response = await fetch(VERSION_ENDPOINT, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch {
    // Not the browser's "Failed to fetch": say what the person can do.
    throw new VersionError('Could not reach the API. Check the connection and try again.');
  }

  if (!response.ok) {
    throw new VersionError(`The API answered ${response.status} ${response.statusText}.`, response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new VersionError('The API answered with a body that is not JSON.');
  }

  return normaliseVersion(body);
}
