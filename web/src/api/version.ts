/**
 * Build information from `GET /api/v1/version`.
 *
 * The api spec (docs/07-api-spec.md §4.8) pins the endpoint but not the exact
 * JSON field names, so the reader is deliberately tolerant: it looks for the
 * documented facts (build version, git commit, live rule set version) under
 * the usual names and keeps the raw payload for display, so the UI never
 * shows a silent blank.
 */

export interface VersionInfo {
  buildVersion?: string;
  gitCommit?: string;
  ruleSetVersion?: string;
  /** The raw response body, kept so unexpected shapes can be shown as-is. */
  raw: unknown;
}

export const VERSION_ENDPOINT = '/api/v1/version';

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function pick(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const found = asString(source[key]);
    if (found !== undefined && found !== '') return found;
  }
  return undefined;
}

/** Pull the documented facts out of whatever shape the api returns. */
export function normaliseVersion(raw: unknown): VersionInfo {
  if (typeof raw !== 'object' || raw === null) {
    return { raw };
  }
  const source = raw as Record<string, unknown>;

  const nestedBuild =
    typeof source.build === 'object' && source.build !== null
      ? (source.build as Record<string, unknown>)
      : undefined;

  const nestedRuleSet =
    typeof source.ruleSet === 'object' && source.ruleSet !== null
      ? (source.ruleSet as Record<string, unknown>)
      : undefined;

  return {
    buildVersion:
      pick(source, ['buildVersion', 'version', 'appVersion', 'build']) ??
      (nestedBuild ? pick(nestedBuild, ['version', 'buildVersion']) : undefined),
    gitCommit:
      pick(source, ['gitCommit', 'commit', 'buildCommit', 'git']) ??
      (nestedBuild ? pick(nestedBuild, ['commit', 'gitCommit']) : undefined),
    ruleSetVersion:
      pick(source, ['ruleSetVersion', 'rulesVersion', 'liveRuleSetVersion']) ??
      (nestedRuleSet ? pick(nestedRuleSet, ['version', 'ruleSetVersion']) : undefined),
    raw,
  };
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
