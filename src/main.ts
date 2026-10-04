import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

/** Creates the app, switches on global request validation and starts listening. */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  await app.listen(process.env.PORT ?? 5000);
}
await bootstrap();
