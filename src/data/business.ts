export const business = {
  name: "Maestros Services",
  phone: "250-858-1781",
  phoneTel: "+12508581781",
  email: "quotes@maestrosservices.com",
  tagline: "Residential Landscaping",
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
  priceRange: "$$",
} as const;

export type Business = typeof business;
