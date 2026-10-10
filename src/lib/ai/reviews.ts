import "server-only";
import type { ReviewAnalysisProvider } from "@/lib/providers/interfaces";
import { notImplemented } from "@/lib/errors";
export const liveReviewAnalysis: ReviewAnalysisProvider = {
  async summarize() {
    // TODO(Reviews): summarize retrieved evidence with config.textModel;
    // retain source attribution and return insufficiency when evidence is absent.
    return notImplemented("Review summarization");
  },
};
