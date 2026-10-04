import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PasswordService } from "./password.service.js";
import { User } from "./user.entity.js";
import { UsersService } from "./users.service.js";

/**
 * Everything about user accounts.
 *
 * - `imports` — `forFeature([User])` registers the User entity with TypeORM and makes a
 *   `Repository<User>` injectable inside this module.
 * - `providers` — classes Nest should create and be able to inject here.
 * - `exports` — providers other modules may use (a module's providers are private
 *   unless exported, which is a big difference from importing files in Express).
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [PasswordService, UsersService],
  exports: [PasswordService, UsersService],
})
export class UsersModule {}
