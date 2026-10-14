import { DocumentSourceError } from "./document-source.js";
import {
  MAX_DOCUMENT_BYTES,
  SupabaseDocumentSource,
} from "./supabase-document-source.js";

const FUNCTION_URL =
  "https://project.supabase.co/functions/v1/get-driver-document";
const FILE_URL =
  "https://project.supabase.co/storage/v1/object/sign/driver-documents/x?token=t";

/** A network in memory: the function answers one way, the signed link another. */
function network(
  functionAnswer: () => Response,
  fileAnswer: () => Response = () => new Response("PNGDATA", { status: 200 }),
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(
      String(url) === FUNCTION_URL ? functionAnswer() : fileAnswer(),
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const signedLink = () =>
  new Response(JSON.stringify({ url: FILE_URL }), { status: 200 });

const source = (fetchImpl: typeof fetch) =>
  new SupabaseDocumentSource({
    functionUrl: FUNCTION_URL,
    token: "secret-token-1234567890",
    fetchImpl,
  });

describe("SupabaseDocumentSource", () => {
  it("asks the function for a signed link with the token, then downloads it", async () => {
    const { calls, fetchImpl } = network(
      signedLink,
      () =>
        new Response("PNGDATA", {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );

    const file = await source(fetchImpl).fetch("2026-10-07/abc.png");

    expect(calls[0].url).toBe(FUNCTION_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(
      (calls[0].init.headers as Record<string, string>)["x-documents-token"],
    ).toBe("secret-token-1234567890");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      path: "2026-10-07/abc.png",
    });
    expect(calls[1].url).toBe(FILE_URL);
    expect(file.body.toString()).toBe("PNGDATA");
    expect(file.contentType).toBe("image/png");
  });

  it("a refused token blocks everything and is not permanent", async () => {
    const { fetchImpl } = network(() => new Response("no", { status: 401 }));

    const error = await source(fetchImpl)
      .fetch("2026-10-07/abc.png")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DocumentSourceError);
    expect(error).toMatchObject({ blocksAll: true, permanent: false });
    expect((error as Error).message).toContain("DOCUMENTS_SOURCE_TOKEN");
  });

  it("a missing file or a refused path is permanent, in plain words", async () => {
    for (const [status, words] of [
      [404, "no longer has this file"],
      [400, "did not accept"],
    ] as const) {
      const { fetchImpl } = network(() => new Response("x", { status }));
      const error = await source(fetchImpl)
        .fetch("2026-10-07/abc.png")
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ permanent: true, blocksAll: false });
      expect((error as Error).message).toContain(words);
    }
  });

  it("a server problem is temporary", async () => {
    const { fetchImpl } = network(() => new Response("x", { status: 503 }));

    await expect(
      source(fetchImpl).fetch("2026-10-07/abc.png"),
    ).rejects.toMatchObject({
      permanent: false,
      blocksAll: false,
    });
  });

  it("refuses a file over the size limit", async () => {
    const { fetchImpl } = network(
      signedLink,
      () =>
        new Response("x", {
          status: 200,
          headers: { "content-length": String(MAX_DOCUMENT_BYTES + 1) },
        }),
    );

    await expect(
      source(fetchImpl).fetch("2026-10-07/abc.png"),
    ).rejects.toMatchObject({
      permanent: true,
    });
  });

  it("only accepts an https function address", () => {
    expect(
      () =>
        new SupabaseDocumentSource({
          functionUrl: "http://project.supabase.co/f",
          token: "secret-token-1234567890",
        }),
    ).toThrow("https");
  });
});
