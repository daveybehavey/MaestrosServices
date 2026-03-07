export interface ProjectProfile {
  id: string;
  title: string;
  summary: string;
  idealFor: string;
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
      "Improve first impressions quickly with lawn, edging, mulching, and cleanup before photos or showings.",
    idealFor: "Homeowners preparing for listing photos, open houses, or appraisal visits.",
    scope: [
      "Lawn mowing and edge cleanup",
      "Hedge and shrub trim-back",
      "Mulching and garden bed refresh",
      "Final debris cleanup and finish pass",
    ],
    relatedServiceHrefs: [
      { label: "Lawn Mowing", href: "/services/lawn-mowing" },
      { label: "Hedge Trimming", href: "/services/hedge-trimming" },
      { label: "Mulching and Garden Beds", href: "/services/garden-bed-maintenance" },
    ],
  },
  {
    id: "power-wash-reset",
    title: "Power Wash Curb Reset",
    summary:
      "Remove algae, grime, and buildup from driveways, patios, and walkways for a faster curb-appeal lift.",
    idealFor: "Entry zones, hard surfaces, and outdoor areas that look weathered or slippery.",
    scope: [
      "Confirm surfaces and safe pressure settings",
      "Clean driveway, patio, walkways, and selected exterior surfaces",
      "Rinse-down and tidy edges around cleaned areas",
      "Optional follow-up plan with seasonal upkeep services",
    ],
    relatedServiceHrefs: [
      { label: "Power Washing", href: "/services/power-washing" },
      { label: "Seasonal Cleanups", href: "/services/seasonal-cleanups" },
    ],
  },
  {
    id: "seasonal-reset",
    title: "Seasonal Full-Property Reset",
    summary:
      "Large spring or fall reset to remove buildup, restore order, and set the property up for the next season.",
    idealFor: "Busy homeowners who want a high-impact cleanup without piecemeal scheduling.",
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
  {
    id: "rock-wall-upgrade",
    title: "Rock Wall and Landscape Edge Upgrade",
    summary:
      "Add durable structure and cleaner transitions with decorative rock edging and small wall builds.",
    idealFor: "Sloped sections, loose bed edges, and front-yard zones that need stronger definition.",
    scope: [
      "Confirm wall/edge layout and drainage path",
      "Prep base and shape the install line",
      "Place and fit rock for a stable, clean finish",
      "Backfill, tidy transitions, and final cleanup",
    ],
    relatedServiceHrefs: [
      { label: "Rock Work and Walls", href: "/services/rock-work-walls" },
      { label: "Mulching and Garden Beds", href: "/services/garden-bed-maintenance" },
    ],
  },
];
