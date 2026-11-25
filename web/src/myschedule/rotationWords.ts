/**
 * A rotation pattern in plain words for the My schedule header (release v1.3
 * S7 review, UI test M1). The api sends the pattern's name, which the 120/150
 * datasets seed as a code ("D12_DAY_4ON4OFF"); the words follow the plan
 * inputs table ("12 h day crew, 4 on, 4 off"). A name that is already words
 * ("8 h rotation") is shown as it is.
 */
const BLOCK_WORDS: Record<string, string> = { DAY: 'day', EVENING: 'evening', NIGHT: 'night' };

export function rotationWords(name: string | null | undefined): string {
  if (!name) return '';
  const crew = /^[DEN](8|12)_(DAY|EVENING|NIGHT)_(\d+)ON(\d+)OFF$/.exec(name);
  if (crew) {
    return `${crew[1]} h ${BLOCK_WORDS[crew[2]]} crew, ${crew[3]} on, ${crew[4]} off`;
  }
  const relief = /^[DEN](8|12)_(DAY|EVENING|NIGHT)_RELIEF$/.exec(name);
  if (relief) return `${relief[1]} h ${BLOCK_WORDS[relief[2]]} relief`;
  const casual = /^CASUAL_(8|12)$/.exec(name);
  if (casual) return `${casual[1]} h relief pool, no fixed rotation`;
  if (/^[A-Z0-9_]+$/.test(name)) {
    // An unknown code: still words, never the raw underscores.
    const spaced = name.replace(/_/g, ' ').toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  return name;
}
