import type { INestApplication } from "@nestjs/common";
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from "@nestjs/swagger";

/**
 * Builds the OpenAPI document: a machine-readable description of every endpoint, its
 * request body and its response. Used in two places:
 * - main.ts serves it at /docs (clickable test page) and /docs-json;
 * - export-openapi.ts writes it to openapi.json, from which the frontend generates
 *   its typed API client.
 *
 * Request and response shapes come from the DTO classes. The Swagger plugin in
 * nest-cli.json reads their TypeScript types (and JSDoc comments) at build time, so the
 * classes need no extra decorators.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Car Rental API")
    .setDescription("Admin and driver API for the car rental platform.")
    .setVersion("0.1.0")
    // Declares "send a Bearer token" and applies it to every endpoint, matching the
    // global auth guard. Public routes simply ignore the token.
    .addBearerAuth()
    .addSecurityRequirements("bearer")
    .build();

  return SwaggerModule.createDocument(app, config);
}
