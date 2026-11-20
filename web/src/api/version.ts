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
    raw,
  };
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
  } catch (cause) {
    throw new VersionError(
      cause instanceof Error ? cause.message : 'Could not reach the API.',
    );
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
