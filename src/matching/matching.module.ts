import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GeminiJsonClient } from "../email-intake/gemini-client.js";
import { AiDriverMatcher } from "./ai-driver-matcher.js";
import { AI_DRIVER_MATCHER, MatchingService } from "./matching.service.js";

/**
 * Payment → driver matching (D48). The AI matcher is built from the LLM settings; without them it is null and
 * matching uses aliases only (everything else goes to review).
 */
@Module({
  providers: [
    {
      provide: AI_DRIVER_MATCHER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AiDriverMatcher | null => {
        const apiKey = config.get<string>("LLM_API_KEY");
        const model = config.get<string>("LLM_MODEL");
        if (!apiKey || !model) return null;
        return new AiDriverMatcher(new GeminiJsonClient({ apiKey, model }));
      },
    },
    MatchingService,
  ],
  exports: [MatchingService],
})
export class MatchingModule {}
