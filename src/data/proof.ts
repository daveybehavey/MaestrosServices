export interface PropertyResetExample {
  id: string;
  area: string;
  serviceType: string;
  situation: string;
  workCompleted: string[];
  outcome: string;
  bestFor: string;
}

export const propertyResetExamples: PropertyResetExample[] = [
  {
    id: "curb-appeal-text-photo",
    area: "Shawnigan Lake / Mill Bay",
    serviceType: "Mulch, edging, and cleanup",
    situation:
      "Front beds looked tired, edges had softened, and the homeowner wanted a fast curb-appeal lift without redesigning the yard.",
    workCompleted: [
      "Cleaned bed edges and removed visible debris",
      "Refreshed mulch depth around high-visibility areas",
      "Completed a final tidy pass around walkways and driveway edges",
    ],
    outcome:
      "The front approach looked cleaner from the street and became easier to maintain between visits.",
    bestFor: "Homeowners who want the yard to look cared for quickly.",
  },
  {
    id: "driveway-after-rain",
    area: "Cowichan Valley",
    serviceType: "Driveway grading and gravel refresh",
    situation:
      "A gravel driveway had rutting, loose edges, and puddling after wet weather, making daily access messier than it needed to be.",
    workCompleted: [
      "Reviewed runoff patterns and low spots",
      "Re-shaped the travel surface and corrected uneven sections",
      "Added aggregate where needed for a cleaner, more stable finish",
    ],
    outcome:
      "Vehicle access felt smoother and the surface looked more intentional from the road.",
    bestFor: "Rural and residential driveways with ruts, potholes, or soft spots.",
  },
  {
    id: "power-wash-entry",
    area: "Greater Victoria",
    serviceType: "Power washing reset",
    situation:
      "Entry surfaces, patio edges, and walkways had dark buildup that made the property feel older and less welcoming.",
    workCompleted: [
      "Confirmed surface type and safe pressure settings",
      "Washed main traffic areas and detailed transitions",
      "Rinsed adjacent edges and completed a cleanup pass",
    ],
    outcome:
      "Hard surfaces looked brighter, safer, and better matched the rest of the property.",
    bestFor: "Homes with slippery-looking algae, grime, or listing-photo prep needs.",
  },
  {
    id: "fence-line-reset",
    area: "Langford / Saanich",
    serviceType: "Fence-line cleanup and minor repair",
    situation:
      "A fence line had overgrowth, uneven visual lines, and small hardware issues that hurt the overall first impression.",
    workCompleted: [
      "Cleared vegetation along key fence sections",
      "Handled practical minor repair and alignment items where feasible",
      "Tidied the base line so the perimeter looked cleaner",
    ],
    outcome:
      "The property edge looked more orderly and the fence became easier to inspect and maintain.",
    bestFor: "Fence sections that are still serviceable but need a cleaner, sharper presentation.",
  },
];

export const quotePageProofSteps = [
  {
    title: "Send the basics",
    detail: "Share your area, service needed, timing, and photos if you have them.",
  },
  {
    title: "Get a practical quote path",
    detail: "We confirm fit, scope, and whether a visit or photo-based estimate makes sense.",
  },
  {
    title: "Know what happens next",
    detail: "You get clear timing, expectations, and cleanup details before work starts.",
  },
] as const;
