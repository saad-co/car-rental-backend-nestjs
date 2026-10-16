import { IsBoolean, IsEnum } from "class-validator";

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
}
