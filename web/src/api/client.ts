import { createFixtureApi } from './fixtures/api';
import { createHttpApi } from './http';
import type { ShiftCircleApi } from './types';

/**
 * The one module that decides where the data comes from.
 *
 * The screens only ever call the typed functions on `api`, so swapping the
 * fixtures for the real api is a change to this file alone.
 *
 * The shipped build talks to the real api. The fixtures are for the tests and
 * for `VITE_API_MODE=fixtures`, and the top bar shows a "demo fixtures" badge
 * whenever they are in use, so fixture data is never mistaken for live data.
 */
const API_MODE = import.meta.env.VITE_API_MODE ?? 'http';

/** True when the screens are reading the typed fixtures instead of the api. */
export const usingFixtures = API_MODE === 'fixtures';

export const api: ShiftCircleApi = usingFixtures ? createFixtureApi() : createHttpApi();

export { ApiError } from './http';
export type {
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
  SaveOutcome,
  SaveRequest,
  SchedulePayload,
  ScheduleQuery,
  ShiftCircleApi,
  ShiftItem,
  ShortHourRange,
} from './types';
