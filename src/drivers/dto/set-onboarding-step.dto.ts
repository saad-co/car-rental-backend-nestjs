import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from "class-validator";
import { MAX_DEPOSIT_CENTS } from "../driver.entity.js";

/** The three onboarding steps of a driver, done in any order (D56). */
export enum OnboardingStep {
  contract = "contract",
  deposit = "deposit",
  vehicle = "vehicle",
}

/** Body of `POST /drivers/:id/onboarding`: tick (`done: true`) or un-tick one step. */
export class SetOnboardingStepDto {
  @IsEnum(OnboardingStep)
  step: OnboardingStep;

  /** `true` marks the step done (now, by the admin); `false` clears it. */
  @IsBoolean()
  done: boolean;

  /**
   * The deposit amount in cents (D82). Required when the deposit step is ticked for the first time; may also be sent
   * with an already-ticked deposit to record or correct the amount. Not allowed for the other steps or with `done: false`.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DEPOSIT_CENTS)
  depositPaidCents?: number;
}
