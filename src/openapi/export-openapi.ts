import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { buildOpenApiDocument } from "./openapi.js";

/**
 * Writes the OpenAPI document to `openapi.json` at the repo root.
 * Run with `npm run openapi:export` after any change to an endpoint or DTO, then
 * regenerate the frontend's API client from the new file.
 *
 * `preview: true` builds the app's structure (modules, controllers, routes) without
 * creating services, so it does not connect to the database or start a server.
 */
async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: ["error", "warn"],
  });

  try {
    const document = buildOpenApiDocument(app);
    const outputPath = join(process.cwd(), "openapi.json");
    writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
    console.log(`OpenAPI document written to ${outputPath}`);
  } finally {
    await app.close();
  }
}

exportOpenApi().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
