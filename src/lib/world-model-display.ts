type DatedRecord = {
  id: string;
};

function toTimestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function createReadableCodes<T extends DatedRecord>(
  records: T[],
  prefix: string,
  dateOf: (record: T) => unknown
) {
  const width = Math.max(3, String(records.length).length);
  return new Map(
    [...records]
      .sort((a, b) => {
        const byDate = toTimestamp(dateOf(a)) - toTimestamp(dateOf(b));
        return byDate === 0 ? a.id.localeCompare(b.id) : byDate;
      })
      .map((record, index) => [record.id, `${prefix}-${String(index + 1).padStart(width, "0")}`])
  );
}

export function readableCode(codes: Map<string, string>, id: string, fallbackPrefix: string) {
  return codes.get(id) ?? `${fallbackPrefix}-?`;
}
