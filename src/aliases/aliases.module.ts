import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PaymentAlias } from "./payment-alias.entity.js";

/**
 * Payment aliases (spec 4, B52). For now it only registers the entity; matching (D48) reads and writes
 * aliases, and alias editing on the driver page comes later.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PaymentAlias])],
  exports: [TypeOrmModule],
})
export class AliasesModule {}
