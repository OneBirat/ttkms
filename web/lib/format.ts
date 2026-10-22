/** Numbers in the lakh/crore grouping used in Nepal: 150000 -> "1,50,000". */
const numberFormat = new Intl.NumberFormat("en-IN");

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}
