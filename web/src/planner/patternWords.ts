import type { OfficerPattern } from '../api/types';

/**
 * The shift patterns in plain words (option C). The api sends each officer's
 * words on the preference row; this map is for the planner's picker, which has
 * to name the options before they are saved.
 */
export const PATTERN_WORDS: Record<OfficerPattern, string> = {
  ROTATING_5_2: 'Rotating 5 on, 2 off (weekends rotate)',
  '5_ON_2_OFF': 'Fixed 5 on, 2 off',
  '7_ON_3_OFF': '7 on, 3 off',
  '4_ON_4_OFF': '4 on, 4 off',
};

/** The patterns a planner may give an 8 h officer. */
export const EIGHT_HOUR_PATTERNS: OfficerPattern[] = ['ROTATING_5_2', '5_ON_2_OFF', '7_ON_3_OFF'];
