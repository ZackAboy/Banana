import "server-only";
import type { IdentificationProvider } from "@/lib/providers/interfaces";
import { notImplemented } from "@/lib/errors";
export const liveIdentification: IdentificationProvider = {
  async identify() {
    // TODO(Vision): use createGeminiClient/config.visionModel, all image evidence,
    // structured output validation and the public Lens/verification interfaces.
    return notImplemented("Gemini identification");
  },
};
