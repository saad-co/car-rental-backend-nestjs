import { QuoApiError } from "./quo-client.js";
import { QuoHttpClient } from "./quo-http-client.js";

/** A fake `fetch` that records the request and answers with a fixed status and JSON body. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const message = {
  id: "ACabc",
  direction: "outgoing",
  from: "+13125550100",
  to: ["+13125550111"],
  text: "Hello",
  status: "queued",
  createdAt: "2026-10-13T15:00:00.000Z",
};

function client(fetchImpl: typeof fetch) {
  return new QuoHttpClient({
    apiKey: "key123",
    phoneNumberId: "PN1",
    fetchImpl,
  });
}

describe("QuoHttpClient", () => {
  it("sends with the raw key (no Bearer), our number id and the contact", async () => {
    const { calls, fetchImpl } = fakeFetch(202, { data: message });

    const sent = await client(fetchImpl).sendText("+13125550111", "Hello");

    expect(calls[0].url).toBe("https://api.quo.com/v1/messages");
    expect(calls[0].init.method).toBe("POST");
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe("key123");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      content: "Hello",
      from: "PN1",
      to: ["+13125550111"],
    });
    expect(sent).toMatchObject({ id: "ACabc", status: "queued", media: [] });
  });

  it("reads history with the repeated participants key and an encoded +", async () => {
    const { calls, fetchImpl } = fakeFetch(200, {
      data: [
        {
          ...message,
          direction: "incoming",
          media: [{ url: "https://x/y.jpg", type: null }],
        },
      ],
      nextPageToken: "next1",
    });

    const page = await client(fetchImpl).listConversation("+13125550111", {
      createdAfter: new Date("2026-10-13T00:00:00.000Z"),
    });

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v1/messages");
    expect(url.searchParams.get("phoneNumberId")).toBe("PN1");
    expect(url.searchParams.getAll("participants")).toEqual(["+13125550111"]);
    expect(calls[0].url).toContain("participants=%2B13125550111");
    expect(url.searchParams.get("createdAfter")).toBe(
      "2026-10-13T00:00:00.000Z",
    );
    expect(page.nextPageToken).toBe("next1");
    expect(page.messages[0].media).toEqual([
      { url: "https://x/y.jpg", type: null },
    ]);
  });

  it("reads a photo-only text, whose words are empty or missing", async () => {
    const photo = {
      ...message,
      direction: "incoming",
      media: [{ url: "https://x/y.jpg", type: "image/jpeg" }],
    };
    const { fetchImpl } = fakeFetch(200, {
      data: [
        { ...photo, id: "AC1", text: "" },
        { ...photo, id: "AC2", text: null },
        { ...photo, id: "AC3", text: undefined },
      ],
      nextPageToken: null,
    });

    const page = await client(fetchImpl).listConversation("+13125550111");

    expect(page.messages.map((m) => m.text)).toEqual(["", "", ""]);
    expect(page.messages.every((m) => m.media.length === 1)).toBe(true);
  });

  it("turns an error answer into a QuoApiError carrying Quo's reason", async () => {
    const { fetchImpl } = fakeFetch(402, { message: "Subscription expired" });

    const error = await client(fetchImpl)
      .sendText("+13125550111", "Hello")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuoApiError);
    expect((error as QuoApiError).status).toBe(402);
    expect((error as QuoApiError).message).toContain("Subscription expired");
  });

  it("rejects an answer with an unknown status instead of guessing", async () => {
    const { fetchImpl } = fakeFetch(202, {
      data: { ...message, status: "weird" },
    });

    await expect(
      client(fetchImpl).sendText("+13125550111", "Hello"),
    ).rejects.toThrow("unknown status");
  });
});
