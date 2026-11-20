import { createFixtureApi } from './fixtures/api';
import { createHttpApi } from './http';
import type { ShiftCircleApi } from './types';

/**
 * The one module that decides where the data comes from.
 *
 * The screens only ever call the typed functions on `api`, so swapping the
 * fixtures for the real api is a change to this file alone: flip
 * `USE_FIXTURES` (or set `VITE_API_MODE=http`). Nothing else in the web
 * imports a fixture or a fetch call.
 */
const USE_FIXTURES = import.meta.env.VITE_API_MODE !== 'http';

export const api: ShiftCircleApi = USE_FIXTURES ? createFixtureApi() : createHttpApi();

export { ApiError } from './http';
export type {
  AssignOutcome,
  AssignRequest,
  BlockCoverage,
  CellItem,
  DayCell,
  HourlyCoverage,
  OfficerRow,
  ProblemDetails,
  RuleCheckOutcome,
  RuleCheckRequest,
  RuleOutcome,
  RuleResult,
  SchedulePayload,
  ScheduleQuery,
  ShiftCircleApi,
  ShiftItem,
  ShortHourRange,
} from './types';
