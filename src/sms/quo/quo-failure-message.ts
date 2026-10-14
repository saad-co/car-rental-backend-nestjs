import { QuoApiError } from "./quo-client.js";

/**
 * A US number Quo can text: `+1`, then an area code and an exchange that do not start with 0 or 1
 * (the North American numbering plan). `+1 3xx` numbers made from a foreign number typed without its country
 * code often fail this, so we say so before asking Quo.
 */
export function isTextableUsNumber(phone: string): boolean {
  return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(phone);
}

/**
 * Turns anything that can go wrong when talking to Quo into one plain sentence an admin can act on. The
 * technical detail (Quo's own words, the status) is NOT shown to the admin; callers log it.
 *
 * Quo's statuses (docs, 2026-10): 400 an invalid number or the A2P registration is not approved, 401 wrong API
 * key, 402 subscription or credits ran out, 403 the daily cap is reached, 404 unknown thing, 429 too many requests.
 */
export function describeQuoFailure(error: unknown): string {
  if (error instanceof QuoApiError) {
    switch (error.status) {
      case 400:
        if (/A2P|registration|campaign|10DLC/i.test(error.reason))
          return "Texting is not approved yet for the business number (A2P registration). Ask the Quo account owner to finish it.";
        if (/phone number|`to`|invalid/i.test(error.reason))
          return "Quo says this phone number is not valid for texting. Check the number on the application or driver.";
        return "Quo refused the text as invalid. Check the number and the message.";
      case 401:
        return "Quo did not accept our connection (API key). Ask the developer to check it.";
      case 402:
        return "The Quo account has no credits left or its subscription has lapsed. Ask the account owner to add credits.";
      case 403:
        return "Quo's daily message limit was reached. Try again tomorrow.";
      case 404:
        return "Quo could not find that number or conversation.";
      case 429:
        return "Quo is receiving too many requests. Try again in a minute.";
      default:
        return error.status >= 500
          ? "Quo had a problem on its side. Try again in a minute."
          : "Quo refused the request. Details are in the server log.";
    }
  }
  if (
    error instanceof Error &&
    (error.message.startsWith("Could not reach Quo") ||
      error.name === "TimeoutError" ||
      error.name === "AbortError")
  )
    return "Could not reach Quo. Check the connection and try again in a minute.";
  if (error instanceof Error && error.message.startsWith("Quo "))
    return "Quo answered in a form we could not read. Details are in the server log.";
  return "Something went wrong. Details are in the server log.";
}
