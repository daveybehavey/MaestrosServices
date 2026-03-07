export const business = {
  name: "Maestros Services",
  phone: "250-858-1781",
  phoneTel: "+12508581781",
  email: "quotes@maestrosservices.com",
  tagline: "Landscaping Services",
  address: {
    locality: "Shawnigan Lake",
    region: "BC",
    country: "CA",
  },
  geo: {
    latitude: "48.6289",
    longitude: "-123.8690",
  },
  siteUrl: "https://maestrosservices.com",
  socialImage: "/og-image.png?v=4",
  sameAs: [
    "https://www.facebook.com/profile.php?id=61588020354024",
  ],
  trackedLinks: {
    googleBusinessQuote:
      "https://maestrosservices.com/quote?utm_source=google_business_profile&utm_medium=organic&utm_campaign=gbp_profile#quote",
    facebookPageQuote:
      "https://maestrosservices.com/quote?utm_source=facebook_page&utm_medium=social&utm_campaign=facebook_profile#quote",
    facebookAdsQuote:
      "https://maestrosservices.com/quote?utm_source=facebook&utm_medium=paid_social&utm_campaign=lead_ads#quote",
  },
  priceRange: "$$",
} as const;

export type Business = typeof business;
