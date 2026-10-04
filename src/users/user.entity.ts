import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export enum Role {
  admin = "admin",
  staff = "staff",
}

// One class = one table. TypeORM reads these decorators to know the table's shape;
// the real table is created by a migration (src/database/migrations).
@Entity("users")
// Backstop: the database itself refuses an email that isn't lower-case.
@Check("users_email_lowercase", `"email" = lower("email")`)
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // unique: true creates a unique index, so two accounts can never share an email,
  // even if two requests arrive at the same instant. varchar(254) = the maximum length
  // of an email address.
  // Always give an explicit `type`: the migration tool runs without TypeScript's emitted
  // type metadata, so TypeORM cannot guess that "string" means varchar.
  @Column({ type: "varchar", length: 254, unique: true })
  email: string;

  // select: false = normal queries never load the hash; login asks for it explicitly.
  @Column({
    name: "password_hash",
    type: "varchar",
    length: 255,
    select: false,
  })
  passwordHash: string;

  @Column({
    type: "enum",
    enum: Role,
    enumName: "user_role",
    default: Role.staff,
  })
  role: Role;

  @Column({ type: "boolean", default: true })
  active: boolean;

  // timestamptz = an exact moment in time (stored as UTC), unlike plain "timestamp".
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
