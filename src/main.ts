import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { buildOpenApiDocument } from "./openapi/openapi.js";

/**
 * Creates the app, allows the configured browser origins, switches on global request
 * validation and starts listening.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // CORS: browsers block a page on one address (e.g. localhost:5173) from calling an API
  // on another (localhost:5000) unless the API says that page is allowed. Only the
  // origins listed in CORS_ORIGINS are allowed. Tokens travel in the Authorization header,
  // not in cookies, so no credentials setting is needed.
  app.enableCors({
    origin: config
      .getOrThrow<string>("CORS_ORIGINS")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  });

  // Validates every request body against its DTO class.
  // - whitelist: drops properties the DTO does not declare.
  // - forbidNonWhitelisted: rejects the request (400) instead of silently dropping them.
  // - transform: turns the plain JSON body into an instance of the DTO class.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API documentation: /docs (clickable test page) and /docs-json (raw document).
  SwaggerModule.setup("docs", app, buildOpenApiDocument(app));

  await app.listen(process.env.PORT ?? 5000);
}
await bootstrap();
