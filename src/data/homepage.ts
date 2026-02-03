import { homepageFaqs } from "./faqs";
import { locationNames } from "./locations";
import { services } from "./services";

export const homepageServiceHighlights = services.map((service) => service.name);

export const homepagePackages = [
  {
    name: "Weekly maintenance",
    description: "Consistent care to keep lawns and beds sharp all season.",
  },
  {
    name: "Bi-weekly maintenance",
    description: "Balanced upkeep for busy homeowners and rental properties.",
  },
  {
    name: "One-time cleanups",
    description: "Perfect for move-ins, pre-sale, or a fresh start.",
  },
  {
    name: "Seasonal prep",
    description: "Spring wake-up and fall reset to protect your yard.",
  },
] as const;

export const homepageServiceAreas = [...locationNames, "Cowichan Valley"];

export { homepageFaqs };
