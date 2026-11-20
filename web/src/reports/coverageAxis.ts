/**
 * The coverage chart's y axis.
 *
 * The labels used to be spread evenly down the side whatever their value,
 * which made 116/100/98/96/98 read like five equal steps and put the
 * "Required (100 %)" line far from the 100 % label (V2). A tick's `top` is the
 * distance from the top of the plot as a percentage, on the same linear scale
 * the bars and the required line use.
 */
export function axisTicks(from: number, to: number): { value: number; top: number }[] {
  const span = to - from;
  const values = [
    from,
    100,
    ...(span >= 12 ? [Math.round((from + 100) / 2), Math.round((100 + to) / 2)] : []),
    to,
  ];
  return [...new Set(values)]
    .filter((value) => value >= from && value <= to)
    .sort((left, right) => left - right)
    .map((value) => ({ value, top: ((to - value) / span) * 100 }));
}
