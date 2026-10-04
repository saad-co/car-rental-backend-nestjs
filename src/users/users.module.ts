import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./user.entity.js";

// forFeature registers the User entity with TypeORM and makes a Repository<User>
// injectable inside this module. Service and controller are added in later steps.
@Module({
  imports: [TypeOrmModule.forFeature([User])],
})
export class UsersModule {}
