import type {
  ProblemDetails,
  RuleCheckOutcome,
  RuleCheckRequest,
  SchedulePayload,
  SaveOutcome,
  SaveRequest,
  ScheduleQuery,
  ShiftCircleApi,
} from './types';

export const API_BASE = '/api/v1';

/** An api answer that was not a success. Carries the Problem Details body. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem?: ProblemDetails;

  constructor(message: string, status: number, problem?: ProblemDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }

  /** True when the api blocked the change with a rule result. */
  get blockedByRules(): boolean {
    return this.problem?.type === 'https://shiftcircle.local/problems/blocked-by-rules';
  }

  /** True when the api wants Warn results acknowledged. */
  get needsAcknowledgement(): boolean {
    return (
      this.problem?.type === 'https://shiftcircle.local/problems/warnings-need-acknowledgement'
    );
  }
}

async function readProblem(response: Response): Promise<ProblemDetails | undefined> {
  try {
    const body = await response.json();
    return typeof body === 'object' && body !== null ? (body as ProblemDetails) : undefined;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : 'Could not reach the API.',
      0,
    );
  }

  if (!response.ok) {
    const problem = await readProblem(response);
    throw new ApiError(
      problem?.detail ?? problem?.title ?? `${response.status} ${response.statusText}`,
      response.status,
      problem,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function queryString(query: ScheduleQuery): string {
  const params = new URLSearchParams();
  if (query.unitId) params.set('unitId', query.unitId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const asString = params.toString();
  return asString ? `?${asString}` : '';
}

/** The real api over HTTP. */
export function createHttpApi(): ShiftCircleApi {
  return {
    getSchedule(query: ScheduleQuery): Promise<SchedulePayload> {
      return request<SchedulePayload>(`/schedule${queryString(query)}`);
    },

    previewRuleCheck(body: RuleCheckRequest): Promise<RuleCheckOutcome> {
      return request<RuleCheckOutcome>('/rule-checks', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },

    saveChange(save: SaveRequest): Promise<SaveOutcome> {
      const { change } = save;
      const body = JSON.stringify({
        change,
        ...(save.acknowledgeWarnings ? { acknowledgeWarnings: save.acknowledgeWarnings } : {}),
        ...(save.override ? { override: save.override } : {}),
      });

      if (change.type === 'MOVE') {
        return request<SaveOutcome>(`/assignments/${change.assignmentId}`, {
          method: 'PATCH',
          body,
        });
      }
      if (change.type === 'CANCEL') {
        return request<SaveOutcome>(`/assignments/${change.assignmentId}`, {
          method: 'DELETE',
          body,
        });
      }
      return request<SaveOutcome>('/assignments', {
        method: 'POST',
        body,
      });
    },
  };
}
