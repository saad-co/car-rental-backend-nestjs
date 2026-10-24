import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

/**
 * A company that can be the Lessor of a contract (Module 2 step 2). A fixed list of five rows put in by the migration
 * (the "Lessor:" lines of the client's sample contracts); there is no screen to change it yet. The name is also printed
 * as the company's signature (D72). Maps to the `contract_companies` table.
 */
@Entity("contract_companies")
// Gonzo Enterprises Inc appears twice with two addresses, so the pair is what is unique, not the name.
@Unique("contract_companies_name_address", ["name", "address"])
export class ContractCompany {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** The company name exactly as it is printed on the contract and as its signature. */
  @Column({ type: "varchar", length: 100 })
  name: string;

  /** The address on one line, exactly as it is printed on the contract (the state is part of it). */
  @Column({ type: "varchar", length: 300 })
  address: string;

  /** The two-letter state whose contract text this company uses (`IL`, `CA`). Illinois and California are built (D74, D76); Tennessee is not. */
  @Column({ type: "char", length: 2 })
  state: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
