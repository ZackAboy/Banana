import "server-only";
import type { Providers } from "./interfaces";
import type { ResponseMeta } from "@/types";
import { getConfig } from "@/lib/config/env";
import { mockProviders } from "@/lib/mock/providers";
import { liveIdentification } from "@/lib/ai/identification";
import { liveReviewAnalysis } from "@/lib/ai/reviews";
import { liveLens } from "@/lib/search/lens";
import { liveShopping } from "@/lib/search/shopping";
import { liveReviewSearch } from "@/lib/search/reviews";
import { liveVerification } from "@/lib/products/verification";
const liveProviders: Providers = {
  identification: liveIdentification,
  reviewAnalysis: liveReviewAnalysis,
  lens: liveLens,
  shopping: liveShopping,
  reviewSearch: liveReviewSearch,
  verification: liveVerification,
};
export function getProviders(): { providers: Providers; meta: ResponseMeta } {
  const { mock } = getConfig();
  return {
    providers: mock ? mockProviders : liveProviders,
    meta: {
      mode: mock ? "mock" : "live",
      notice: mock
        ? "Synthetic demo data. Images are not analyzed; prices and opinions are illustrative."
        : null,
    },
  };
}
