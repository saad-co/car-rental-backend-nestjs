import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LedgerPreset } from "./ledger-preset.entity.js";
import { LedgerPresetsController } from "./ledger-presets.controller.js";
import { LedgerPresetsService } from "./ledger-presets.service.js";

/** The quick-pick presets of the "New ledger entry" window (B86, D66). */
@Module({
  imports: [TypeOrmModule.forFeature([LedgerPreset])],
  controllers: [LedgerPresetsController],
  providers: [LedgerPresetsService],
})
export class LedgerPresetsModule {}
