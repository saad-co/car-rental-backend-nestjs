/** Small checks for reading Quo's JSON answers. Anything unexpected is an error, never a guess. */

/** `value[key]`; throws when `value` is not an object, or the key is missing (unless `optional`). */
export function field(value: unknown, key: string, optional = false): unknown {
  if (value === null || typeof value !== "object")
    throw new Error(`Quo answer is not an object (looking for '${key}').`);
  const found = (value as Record<string, unknown>)[key];
  if (found === undefined && !optional)
    throw new Error(`Quo answer is missing '${key}'.`);
  return found;
}

/** A required non-empty string field. */
export function str(value: unknown, key: string): string {
  const found = field(value, key);
  if (typeof found !== "string" || found === "")
    throw new Error(`Quo field '${key}' is not a non-empty string.`);
  return found;
}

/** An optional string field: a string, or null when missing or null. */
export function optionalStr(value: unknown, key: string): string | null {
  const found = field(value, key, true);
  return typeof found === "string" && found !== "" ? found : null;
}
