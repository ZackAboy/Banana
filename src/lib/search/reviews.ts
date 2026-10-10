import "server-only";
import type { ReviewSearchProvider } from "@/lib/providers/interfaces";
import { notImplemented } from "@/lib/errors";
export const liveReviewSearch: ReviewSearchProvider = {
  async search() {
    // TODO(Reviews): SerpApi Search for Reddit/reviews; preserve URLs and dates.
    return notImplemented("Review discovery");
  },
};
