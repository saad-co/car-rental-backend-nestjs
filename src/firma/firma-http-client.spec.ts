import { FirmaError, type FirmaSendRequest } from "./firma-client.js";
import { FirmaHttpClient } from "./firma-http-client.js";

const request: FirmaSendRequest = {
  name: "Vehicle Lease Agreement - Test LLC",
  pdf: Buffer.from("%PDF-1.4 test"),
  recipient: { firstName: "Test", lastName: "Driver", email: "d@test.test" },
  anchors: [
    {
      kind: "text",
      anchor: "{{LESSEE_NAME}}",
      value: "Test Driver",
      fontSize: 11,
      widthPct: 12.5,
      heightPct: 1.9,
      xOffsetPct: 0,
    },
    {
      kind: "signature",
      anchor: "{{LESSEE_SIGNATURE}}",
      widthPct: 20,
      heightPct: 3.6,
      xOffsetPct: 0,
      yOffsetPct: -2,
    },
    {
      kind: "date",
      anchor: "{{LESSEE_DATE}}",
      widthPct: 17,
      heightPct: 1.7,
      xOffsetPct: 0,
      fontSize: 11,
    },
  ],
};

function respond(status: number, body: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      }),
    );
}

describe("FirmaHttpClient", () => {
  it("refuses to be built without a key", () => {
    expect(() => new FirmaHttpClient({ apiKey: "" })).toThrow(/FIRMA_API_KEY/);
  });

  it("posts the PDF and the anchors with the key alone in Authorization, and returns firma's id", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new FirmaHttpClient({
      apiKey: "secret-key",
      fetchImpl: (url, init) => {
        seen = { url: url as string, init: init as RequestInit };
        return respond(201, { id: "req-1", status: "sent" })(url, init);
      },
    });

    await expect(client.createAndSend(request)).resolves.toEqual({
      signingRequestId: "req-1",
    });

    expect(seen?.url).toBe(
      "https://api.firma.dev/functions/v1/signing-request-api/signing-requests/create-and-send",
    );
    expect(seen?.init.method).toBe("POST");
    expect(seen?.init.headers).toMatchObject({ Authorization: "secret-key" });
    const body = JSON.parse(seen?.init.body as string) as Record<string, any>;
    expect(body.name).toBe("Vehicle Lease Agreement - Test LLC");
    expect(body.document).toBe(request.pdf.toString("base64"));
    expect(body.recipients).toEqual([
      {
        id: "temp_1",
        first_name: "Test",
        last_name: "Driver",
        email: "d@test.test",
        designation: "Signer",
      },
    ]);
    expect(body.anchor_tags).toHaveLength(3);
    expect(body.anchor_tags[0]).toMatchObject({
      anchor_string: "{{LESSEE_NAME}}",
      type: "text",
      recipient_id: "temp_1",
      read_only: true,
      read_only_value: "Test Driver",
      font_size: 11,
      width: 12.5,
      height: 1.9,
      ignore_if_not_present: false,
      remove_anchor_text: true,
      add_white_background: true,
    });
    expect(body.anchor_tags[1]).toMatchObject({
      type: "signature",
      y_offset: -2,
    });
    expect(body.anchor_tags[1]).not.toHaveProperty("read_only");
    expect(body.anchor_tags[2]).toMatchObject({
      type: "date",
      date_signing_default: true,
    });
  });

  it("turns firma's refusal into a FirmaError with firma's own words and without the key", async () => {
    const client = new FirmaHttpClient({
      apiKey: "secret-key",
      fetchImpl: respond(400, {
        error: "anchor_tags[0]: recipient_id 'temp_1' not found in recipients",
        code: "VALIDATION_ERROR",
      }),
    });
    const error = await client.createAndSend(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FirmaError);
    expect((error as FirmaError).status).toBe(400);
    expect((error as FirmaError).message).toContain("recipient_id 'temp_1'");
    expect((error as FirmaError).message).not.toContain("secret-key");
  });

  it("copes with an error body that is not JSON", async () => {
    const client = new FirmaHttpClient({
      apiKey: "k",
      fetchImpl: respond(502, "Bad gateway"),
    });
    await expect(client.createAndSend(request)).rejects.toThrow(
      "firma refused the request (502): Bad gateway",
    );
  });

  it("refuses an answer without an id", async () => {
    const client = new FirmaHttpClient({
      apiKey: "k",
      fetchImpl: respond(201, { status: "sent" }),
    });
    await expect(client.createAndSend(request)).rejects.toThrow(
      /no signing request id/,
    );
  });

  it("says firma may still have the request when it did not answer", async () => {
    const client = new FirmaHttpClient({
      apiKey: "secret-key",
      fetchImpl: () => Promise.reject(new Error("socket hang up")),
    });
    const error = await client.createAndSend(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FirmaError);
    expect((error as FirmaError).status).toBeNull();
    expect((error as FirmaError).message).toContain("socket hang up");
    expect((error as FirmaError).message).toContain("dashboard");
    expect((error as FirmaError).message).not.toContain("secret-key");
  });
});
