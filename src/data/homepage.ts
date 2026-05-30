import { homepageFaqs } from "./faqs";
import { locationNames } from "./locations";
import { services } from "./services";

export const homepageServiceHighlights = services.map((service) => service.name);

export const homepagePackages = [
  {
    name: "Fence Refresh and Minor Repair",
    description:
      "Fence-line cleanup plus practical panel, rail, or hardware fixes to improve curb appeal and function.",
  },
  {
    name: "Rock Work Refresh",
    description:
      "Decorative rock edging and small wall touch-ups to restore structure and cleaner property lines.",
  },
  {
    name: "Power Wash Reset",
    description:
      "Driveways, patios, and walkways cleaned up fast when surfaces look tired or slippery.",
  },
  {
    name: "Mulch Refresh",
    description:
      "Fresh mulch top-up with edge cleanup to make garden beds look clean and easier to maintain.",
  },
] as const;

export const homepageServiceAreas = [...locationNames, "Cowichan Valley"];

export const homepageTrustProof = [
  "Owner-operated from first message to cleanup.",
  "Most messages during work hours get a reply within 1 hour.",
  "Serving homeowners across Shawnigan, Cowichan, and Greater Victoria.",
] as const;

export const homepageTrustMoments = [
  {
    title: "Clear answer on fit",
    detail:
      "If a smaller fix, different service, or another trade makes more sense, we say that early instead of padding the job.",
  },
  {
    title: "Quick quote path",
    detail:
      "Texting photos, your area, and timing is usually enough for us to confirm the practical next step quickly.",
  },
  {
    title: "Privacy-friendly proof",
    detail:
      "We only publish approved photos and use privacy-safe scope examples when homeowners prefer not to share property images publicly.",
  },
] as const;

export const homepageTrustSignals = [
  {
    title: "Clear scope before work starts",
    detail:
      "We confirm the service plan, timing, and price before the visit so there are no surprises.",
  },
  {
    title: "Owner-operated communication",
    detail:
      "You get direct updates from the person doing the work, including scheduling and scope changes.",
  },
  {
    title: "Respect for your property",
    detail:
      "We work carefully around access points, driveways, beds, and existing landscaping features.",
  },
  {
    title: "Clean finish at closeout",
    detail:
      "Each visit ends with tidy edges, debris pickup, and a final walkthrough of completed scope.",
  },
] as const;

export const homepageOutcomeHighlights = [
  {
    title: "Cleaner curb appeal",
    detail:
      "Fresh mulching, sharper edges, and washed hard surfaces that look cleaner from the street.",
  },
  {
    title: "Better driveway usability",
    detail:
      "Smoother access and improved drainage behavior through grading and gravel correction.",
  },
  {
    title: "Stronger landscape structure",
    detail:
      "Rock borders and small wall builds that hold lines and improve layout definition.",
  },
  {
    title: "Simpler ongoing maintenance",
    detail:
      "Yards are set up to be easier to maintain with less weekly effort for homeowners.",
  },
] as const;

export { homepageFaqs };
