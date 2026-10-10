import type {
  ProductCandidate,
  ProductIdentification,
  ProductOffer,
  ReviewInsights,
  ReviewSource,
} from "@/types";
export const demoCandidate: ProductCandidate = {
  id: "lg-27gp850-b",
  brand: "LG",
  productName: "UltraGear 27GP850-B",
  modelNumber: "27GP850-B",
  variant: "27-inch · QHD · 165 Hz",
  source: "Synthetic demo candidate",
  sourceUrl: "https://www.lg.com/us/monitors/lg-27gp850-b-gaming-monitor",
  evidence: [
    "Demo label reads 27GP850-B",
    "Demo visual features match the monitor family",
  ],
  matchReason:
    "Illustrative model-label match. This is fixture data, not image analysis.",
};
export function demoIdentification(
  confirmed: boolean,
  selected = false,
): ProductIdentification {
  return {
    brand: "LG",
    productName: confirmed ? "UltraGear 27GP850-B" : "UltraGear gaming monitor",
    modelNumber: confirmed ? "27GP850-B" : null,
    sku: null,
    variant: confirmed ? demoCandidate.variant : null,
    category: "Gaming monitor",
    visibleText: confirmed ? ["LG", "27GP850-B"] : ["LG", "UltraGear"],
    distinguishingFeatures: [
      "Black display with a slim bezel",
      "Angular stand and red rear accent",
    ],
    identificationStatus: confirmed ? "confirmed" : "likely",
    reasoning: selected
      ? "You selected this synthetic candidate. The demo treats your choice as confirmation; no image analysis was performed."
      : confirmed
        ? "Synthetic demo: model-label evidence confirms the sample identity. Your image content was not analyzed."
        : "Synthetic demo: the product family is plausible, but the exact model needs a readable label. Your image content was not analyzed.",
    suggestedNextImage: confirmed
      ? null
      : "Take a clear photo of the model/SKU label on the back of the monitor.",
    candidates: [demoCandidate],
  };
}
export function demoOffers(): ProductOffer[] {
  return [
    {
      retailer: "Sample retailer A",
      price: 299.99,
      condition: "new" as const,
      availability: "Demo: in stock",
    },
    {
      retailer: "Sample retailer B",
      price: 319.0,
      condition: "new" as const,
      availability: "Demo: in stock",
    },
    {
      retailer: "Sample renewed store",
      price: 239.0,
      condition: "refurbished" as const,
      availability: "Demo: limited stock",
    },
  ].map((offer) => ({
    ...offer,
    productName: "LG UltraGear 27GP850-B · 27-inch QHD",
    currency: "USD",
    productUrl: "https://example.com/demo-offer",
    imageUrl: null,
    retrievedAt: new Date().toISOString(),
  }));
}
export const demoSources: ReviewSource[] = [
  {
    title: "Illustrative community discussion",
    source: "Synthetic Reddit-style fixture",
    url: "https://example.com/demo-community-source",
    snippet:
      "Example evidence: fast motion and rich color; contrast in a dark room is a tradeoff.",
    publishedAt: null,
  },
  {
    title: "Illustrative monitor review",
    source: "Synthetic review fixture",
    url: "https://example.com/demo-review-source",
    snippet:
      "Example evidence: QHD detail and adjustable stand; check desk depth and connectivity.",
    publishedAt: null,
  },
];
export function demoInsights(sources: ReviewSource[]): ReviewInsights {
  return {
    pros: [
      "Smooth motion for fast-paced games",
      "Rich color and crisp QHD detail",
      "Useful height and tilt adjustment",
    ],
    cons: [
      "Limited contrast in a dark room",
      "HDR expectations need to stay modest",
    ],
    recurringThemes: [
      "A balance of gaming speed and everyday clarity",
      "Room lighting affects the viewing experience",
    ],
    caveats: [
      "All opinions here are synthetic examples, not retrieved reviews.",
      "Check the exact model, condition, warranty, and final checkout price.",
    ],
    overallSummary:
      "This sample demonstrates how source evidence becomes a readable overview. No live discussions were retrieved.",
    recommendation:
      "Example recommendation: consider this type of QHD monitor for mixed gaming and everyday use. Compare current verified offers and read real sources before buying.",
    sources,
  };
}
