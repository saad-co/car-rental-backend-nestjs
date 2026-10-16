/**
 * Developer tool: lists, creates and deletes the Quo webhook that delivers text events to our API (D50).
 * NOT part of the API. `list` is read-only; `create` and `delete` CHANGE the client's Quo workspace, so run
 * them only when Saad has agreed.
 *
 *   npm run quo:webhook -- list
 *   npm run quo:webhook -- create https://<our backend>/webhooks/quo
 *   npm run quo:webhook -- test <webhook id>         (Quo sends a sample event to our URL; no real text)
 *   npm run quo:webhook -- deliveries <webhook id>   (did our API accept it? success / failed)
 *   npm run quo:webhook -- delete <webhook id>
 *
 * Why a script and not the dashboard: a webhook made through the API with `Quo-Api-Version: 2026-03-30` is
 * pinned to the payload and signature format our code checks. `create` listens only to our one number
 * (`QUO_PHONE_NUMBER_ID`) and only to text events, so the client's other lines never reach us (D51).
 * It prints the signing secret (`whsec_...`) ONCE: put it in the backend's `QUO_WEBHOOK_SECRET` yourself and
 * never paste it anywhere else. Needs `QUO_API_KEY` and `QUO_PHONE_NUMBER_ID` in your `.env`.
 */
const BASE_URL = "https://api.quo.com";
const EVENTS = [
  "message.received",
  "message.delivered",
  "message.failed",
  "message.undelivered",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is missing. Add it to .env (see .env.example).`);
  return value;
}

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: requireEnv("QUO_API_KEY"),
      "Quo-Api-Version": "2026-03-30",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `Quo answered ${method} ${path} with ${response.status}: ${text.slice(0, 300)}`,
    );
  return text === "" ? null : (JSON.parse(text) as { data?: unknown });
}

const [command, argument] = process.argv.slice(2);

if (command === "list") {
  const answer = await call("GET", "/webhooks");
  const hooks = (answer?.data ?? []) as {
    id: string;
    url: string;
    status: string;
    label?: string;
    events: string[];
    resourceIds: string[];
  }[];
  console.log(`${hooks.length} webhook(s) in the Quo workspace:\n`);
  for (const hook of hooks) {
    console.log(
      `${hook.id}  ${hook.status}  ${hook.url}\n    label: ${hook.label ?? "-"}  numbers: ${hook.resourceIds.join(",")}  events: ${hook.events.join(",")}`,
    );
  }
} else if (command === "create") {
  if (!argument?.startsWith("https://"))
    throw new Error(
      "Usage: npm run quo:webhook -- create https://<our backend>/webhooks/quo (https only)",
    );
  const answer = await call("POST", "/webhooks", {
    url: argument,
    events: EVENTS,
    resourceIds: [requireEnv("QUO_PHONE_NUMBER_ID")],
    label: "GonzoCar chat",
  });
  const hook = answer?.data as { id: string; key: string };
  console.log(`Created webhook ${hook.id} for ${argument}`);
  console.log(
    "\nSigning secret (shown ONCE; put it in QUO_WEBHOOK_SECRET on the backend):",
  );
  console.log(hook.key);
} else if (command === "test") {
  if (!argument)
    throw new Error("Usage: npm run quo:webhook -- test <webhook id>");
  // Quo sends a sample `message.received` to our URL, signed with the real secret. The sample sender is nobody's
  // phone, so our API answers 200 "skipped": that proves the signature and the payload format, with no real text.
  const answer = await call(
    "POST",
    `/webhooks/${encodeURIComponent(argument)}/events/test`,
    { eventType: "message.received" },
  );
  console.log(
    "Test event dispatched (asynchronously). Check the result in a few seconds with:",
  );
  console.log(`  npm run quo:webhook -- deliveries ${argument}`);
  console.log(JSON.stringify(answer, null, 2).slice(0, 800));
} else if (command === "deliveries") {
  if (!argument)
    throw new Error("Usage: npm run quo:webhook -- deliveries <webhook id>");
  const answer = await call(
    "GET",
    `/webhooks/${encodeURIComponent(argument)}/events?limit=10`,
  );
  const deliveries = (answer?.data ?? []) as {
    id: string;
    eventType: string;
    status: string;
    nextAttemptAt: string | null;
    createdAt: string;
  }[];
  console.log(`${deliveries.length} recent delivery(ies), newest first:\n`);
  for (const d of deliveries) {
    console.log(
      `${d.createdAt}  ${d.status.toUpperCase().padEnd(8)} ${d.eventType}${d.nextAttemptAt ? `  (retry at ${d.nextAttemptAt})` : ""}`,
    );
  }
} else if (command === "delete") {
  if (!argument)
    throw new Error("Usage: npm run quo:webhook -- delete <webhook id>");
  await call("DELETE", `/webhooks/${encodeURIComponent(argument)}`);
  console.log(`Deleted webhook ${argument}.`);
} else {
  throw new Error(
    "Usage: npm run quo:webhook -- list | create <https url> | test <id> | deliveries <id> | delete <id>",
  );
}
