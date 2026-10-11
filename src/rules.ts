/**
 * Shared rule plumbing for both conversion directions.
 *
 * Rules are declared as arrays for a readable public API, but both paths need
 * `type` → rule lookups on every node. Indexing once per conversion keeps the
 * lookup O(1) and — more importantly — means a nested conversion sees exactly
 * the same rules as the one that spawned it.
 */

/**
 * Index rules by their `type` key. A later rule with the same `type` wins,
 * matching the `new Map(rules.map(...))` behaviour both paths used before.
 */
export function indexRulesByType<T extends { type: string }>(
  rules: readonly T[] | undefined,
): ReadonlyMap<string, T> {
  const indexed = new Map<string, T>();
  for (const rule of rules ?? []) {
    indexed.set(rule.type, rule);
  }
  return indexed;
}
