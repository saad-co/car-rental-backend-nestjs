import { ConflictException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { PasswordService } from "./password.service.js";
import { Role, User } from "./user.entity.js";

/** What is needed to create a user. The password is plain text here and is hashed inside. */
export interface CreateUserInput {
  email: string;
  password: string;
  role: Role;
}

/**
 * Creates and looks up user accounts. Business logic lives here; controllers only call it.
 *
 * Nest creates this class once and passes in the two things its constructor asks for:
 * a `Repository<User>` (TypeORM's equivalent of a Mongoose model: find, save, ...)
 * and the `PasswordService`.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly passwords: PasswordService,
  ) {}

  /** Emails are stored trimmed and lower-case, so `A@x.com` and `a@x.com` are one account. */
  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Creates a user with a hashed password.
   * @throws ConflictException if the email is already taken.
   */
  async create(input: CreateUserInput): Promise<User> {
    const user = this.users.create({
      email: this.normalizeEmail(input.email),
      passwordHash: await this.passwords.hash(input.password),
      role: input.role,
    });

    try {
      return await this.users.save(user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("A user with this email already exists.");
      }
      throw error;
    }
  }

  /** Finds a user by email. The password hash is NOT included. */
  findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email: this.normalizeEmail(email) } });
  }

  /** Finds a user by id. The password hash is NOT included. */
  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  /**
   * Finds a user by email INCLUDING the password hash. Only the login code should use
   * this. `passwordHash` is excluded from normal queries (`select: false` on the entity),
   * so it must be requested explicitly with `addSelect`.
   *
   * `:email` is a query parameter: the value is sent to Postgres separately from the SQL
   * text, which prevents SQL injection.
   */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder("user")
      .addSelect("user.passwordHash")
      .where("user.email = :email", { email: this.normalizeEmail(email) })
      .getOne();
  }
}
