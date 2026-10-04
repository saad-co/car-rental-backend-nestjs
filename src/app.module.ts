import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { validateEnv } from "./config/env.validation.js";
import { buildBaseOptions } from "./database/typeorm-options.js";
import { UsersModule } from "./users/users.module.js";

@Module({
  imports: [
    // Loads .env, checks it with validateEnv, and makes ConfigService available everywhere.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Opens the Postgres connection. useFactory runs after ConfigModule is ready, so
    // DATABASE_URL has already been validated by the time we read it here.
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...buildBaseOptions(config.getOrThrow<string>("DATABASE_URL")),
        autoLoadEntities: true, // pick up entities registered via TypeOrmModule.forFeature
      }),
    }),
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
