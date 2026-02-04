export interface ProjectProfile {
  id: string;
  title: string;
  summary: string;
  idealFor: string;
  timeline: string;
  scope: string[];
  relatedServiceHrefs: Array<{ label: string; href: string }>;
}

export const projectProfiles: ProjectProfile[] = [
  {
    id: "driveway-refresh",
    title: "Gravel Driveway Refresh and Re-Level",
    summary:
      "Correct rutting, improve water runoff, and restore a clean driveway finish with grading plus fresh aggregate.",
    idealFor: "Rural and residential properties with puddles, washboarding, or soft spots.",
    timeline: "Most small-to-mid driveways are completed in 1 day.",
    scope: [
      "Assess runoff and crown shape",
      "Re-level surface and correct problem areas",
      "Add and spread aggregate where needed",
      "Compact and finish edges for a cleaner look",
    ],
    relatedServiceHrefs: [
      { label: "Driveway Grading", href: "/services/driveway-grading" },
      {
        label: "Gravel Driveway Installation",
        href: "/services/gravel-driveway-installation",
      },
    ],
  },
  {
    id: "overgrowth-reset",
    title: "Overgrowth Reset and Property Reclaim",
    summary:
      "Bring unmanaged spaces back under control so the property is usable, safer, and easier to maintain.",
    idealFor: "Acreages, edge-of-forest lots, rental turnovers, and neglected side yards.",
    timeline: "Often 1 to 2 days, depending on density and access.",
    scope: [
      "Brush and invasive growth clearing",
      "Targeted trimming and shape-back work",
      "Yard waste haul-away",
      "Optional follow-up maintenance plan",
    ],
    relatedServiceHrefs: [
      { label: "Brush Clearing", href: "/services/brush-clearing" },
      { label: "Yard Waste Removal", href: "/services/yard-waste-removal" },
    ],
  },
  {
    id: "curb-appeal-upgrade",
    title: "Curb Appeal Upgrade for Listings and Refi",
    summary:
      "Improve first impressions quickly with lawn, edge, hedge, and garden-bed cleanup before photos or showings.",
    idealFor: "Homeowners preparing for listing photos, open houses, or appraisal visits.",
    timeline: "Usually completed within a single service visit.",
    scope: [
      "Lawn mowing and edge cleanup",
      "Hedge and shrub trim-back",
      "Garden bed refresh and weed control",
      "Final debris cleanup and finish pass",
    ],
    relatedServiceHrefs: [
      { label: "Lawn Mowing", href: "/services/lawn-mowing" },
      { label: "Hedge Trimming", href: "/services/hedge-trimming" },
      { label: "Garden Bed Maintenance", href: "/services/garden-bed-maintenance" },
    ],
  },
  {
    id: "seasonal-reset",
    title: "Seasonal Full-Property Reset",
    summary:
      "Large spring or fall reset to remove buildup, restore order, and set the property up for the next season.",
    idealFor: "Busy homeowners who want a high-impact cleanup without piecemeal scheduling.",
    timeline: "Typically 1 day for average lots, longer for larger properties.",
    scope: [
      "Leaf and debris clearing across the lot",
      "Beds, pathways, and fence lines tidied",
      "Targeted weed control and trim-back",
      "Haul-away and closeout walkthrough",
    ],
    relatedServiceHrefs: [
      { label: "Seasonal Cleanups", href: "/services/seasonal-cleanups" },
      { label: "Weed Control", href: "/services/weed-control" },
    ],
  },
];
