import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AliasesModule } from "./aliases/aliases.module.js";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { validateEnv } from "./config/env.validation.js";
import { buildBaseOptions } from "./database/typeorm-options.js";
import { DriversModule } from "./drivers/drivers.module.js";
import { ApplicationsModule } from "./applications/applications.module.js";
import { MessageTemplatesModule } from "./message-templates/message-templates.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { EmailIntakeModule } from "./email-intake/email-intake.module.js";
import { LedgerModule } from "./ledger/ledger.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { SmsModule } from "./sms/sms.module.js";
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
    // Runs @Cron methods (the email intake every 3 minutes). Registered once, here.
    ScheduleModule.forRoot(),
    UsersModule,
    AuthModule,
    ApplicationsModule,
    MessageTemplatesModule,
    DriversModule,
    EmailIntakeModule,
    PaymentsModule,
    AliasesModule,
    LedgerModule,
    SmsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
