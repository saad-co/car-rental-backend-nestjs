/**
 * What an inbound text says about texting the sender (spec section 8: "Inbound STOP (and common variants) sets it").
 * The standard carrier keywords: a text that is just one of these words, in any case, with or without punctuation.
 * Anything longer ("please stop by tomorrow") is an ordinary message and changes nothing.
 */
const STOP_WORDS = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
]);
const START_WORDS = new Set(["start", "unstop"]);

/** `stop`: the sender asked us to stop texting; `start`: they asked to be texted again; null: neither. */
export function optOutKeyword(text: string): "stop" | "start" | null {
  const word = text
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/g, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  return null;
}
