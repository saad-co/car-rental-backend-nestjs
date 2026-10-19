import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { isUniqueViolation } from "../database/postgres-errors.js";
import {
  CreateLedgerPresetDto,
  LedgerPresetDto,
  UpdateLedgerPresetDto,
} from "./dto/ledger-preset.dto.js";
import { LedgerPreset, LedgerPresetKind } from "./ledger-preset.entity.js";

/**
 * The quick-pick cards of the "New ledger entry" window (B86, D66): admins keep a list per kind in Settings. The
 * migration inserts the client's starting list. A preset only supplies text and an amount when an entry is made, so
 * nothing here can change a ledger entry.
 */
@Injectable()
export class LedgerPresetsService {
  constructor(
    @InjectRepository(LedgerPreset)
    private readonly presets: Repository<LedgerPreset>,
    private readonly dataSource: DataSource,
  ) {}

  /** Every preset: charges first, then credits, each in the order of its cards. */
  async list(): Promise<LedgerPresetDto[]> {
    const rows = await this.presets.find({
      // The kind column is an enum: Postgres sorts it in the order the values were declared (charge, credit).
      order: { kind: "ASC", position: "ASC", id: "ASC" },
    });
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Adds a preset at the end of its kind.
   * @throws ConflictException if the kind already has a preset with this name.
   */
  async create(
    input: CreateLedgerPresetDto,
    adminId: string,
  ): Promise<LedgerPresetDto> {
    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const [{ last }] = (await manager.query(
          `SELECT COALESCE(MAX(position), 0)::int AS last FROM ledger_presets WHERE kind = $1`,
          [input.kind],
        )) as [{ last: number }];
        return manager.save(
          manager.create(LedgerPreset, {
            kind: input.kind,
            name: input.name,
            amountCents: input.amountCents ?? null,
            description: input.description,
            position: last + 1,
            updatedById: adminId,
          }),
        );
      });
      return this.toDto(saved);
    } catch (error) {
      throw this.nameClash(error, input.name);
    }
  }

  /**
   * Replaces a preset's name, amount and description. The kind and the position stay.
   * @throws NotFoundException no preset with this id.
   * @throws ConflictException the kind already has another preset with this name.
   */
  async update(
    id: string,
    input: UpdateLedgerPresetDto,
    adminId: string,
  ): Promise<LedgerPresetDto> {
    const preset = await this.presets.findOneBy({ id });
    if (!preset) throw new NotFoundException("Preset not found.");
    preset.name = input.name;
    preset.amountCents = input.amountCents ?? null;
    preset.description = input.description;
    preset.updatedById = adminId;
    try {
      return this.toDto(await this.presets.save(preset));
    } catch (error) {
      throw this.nameClash(error, input.name);
    }
  }

  /**
   * Deletes a preset. Entries made from it are not affected (they only hold the copied text and amount).
   * @throws NotFoundException no preset with this id.
   */
  async remove(id: string): Promise<void> {
    const result = await this.presets.delete({ id });
    if (!result.affected) throw new NotFoundException("Preset not found.");
  }

  /**
   * Sets the order of one kind's cards. `ids` must be exactly that kind's presets, each once, so a stale screen (a preset
   * added or deleted meanwhile) is refused instead of silently dropping or inventing a card.
   * @throws BadRequestException the ids are not exactly the kind's presets.
   */
  async reorder(kind: LedgerPresetKind, ids: string[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const current = await manager.find(LedgerPreset, {
        where: { kind },
        select: { id: true },
      });
      const same =
        current.length === ids.length &&
        current.every((preset) => ids.includes(preset.id));
      if (!same) {
        throw new BadRequestException(
          "The list changed: reload the page and try again.",
        );
      }
      for (const [index, id] of ids.entries()) {
        await manager.update(LedgerPreset, { id }, { position: index + 1 });
      }
    });
  }

  private nameClash(error: unknown, name: string): unknown {
    if (isUniqueViolation(error, "ledger_presets_kind_name")) {
      return new ConflictException(
        `There is already a preset called "${name}".`,
      );
    }
    return error;
  }

  private toDto(row: LedgerPreset): LedgerPresetDto {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      amountCents: row.amountCents,
      description: row.description,
      position: row.position,
      updatedAt: row.updatedAt,
    };
  }
}
