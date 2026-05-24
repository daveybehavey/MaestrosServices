export type RegionName = "Greater Victoria" | "Cowichan Valley";

export interface Location {
  id: string;
  slug: string;
  name: string;
  region: RegionName;
  description: string;
  neighborhoods?: string[];
  nearbyAreas: string[];
  localLandmarks?: string[];
}

export interface Region {
  id: string;
  name: RegionName;
  description: string;
  locationIds: string[];
}

export const locations: Location[] = [
  // Greater Victoria
  {
    id: "victoria",
    slug: "victoria",
    name: "Victoria",
    region: "Greater Victoria",
    description: "Residential landscaping in Victoria, BC for homeowners who want reliable lawn care, garden maintenance, and seasonal cleanups. From James Bay to Fernwood, we keep the focus on clear communication, tidy finishes, and practical service that feels easy to book and easy to trust. It is a strong fit for homes that need regular upkeep, front-yard curb appeal work, or a one-time reset.",
    neighborhoods: ["James Bay", "Fairfield", "Oak Bay", "Fernwood", "Rockland", "Gonzales", "Hillside"],
    nearbyAreas: ["saanich", "esquimalt", "oak-bay"],
    localLandmarks: ["Beacon Hill Park", "Inner Harbour", "Government Street"],
  },
  {
    id: "saanich",
    slug: "saanich",
    name: "Saanich",
    region: "Greater Victoria",
    description: "Residential lawn care and landscaping throughout Saanich, from Gordon Head to Royal Oak. We handle mowing, trimming, cleanups, and ongoing maintenance with a clean, homeowner-friendly approach that fits real neighborhood properties. The page is built for homeowners comparing routine upkeep, seasonal work, and faster quote response.",
    neighborhoods: ["Gordon Head", "Cadboro Bay", "Royal Oak", "Broadmead", "Cordova Bay", "Shelbourne"],
    nearbyAreas: ["victoria", "central-saanich", "oak-bay"],
    localLandmarks: ["Mount Douglas Park", "University of Victoria"],
  },
  {
    id: "central-saanich",
    slug: "central-saanich",
    name: "Central Saanich",
    region: "Greater Victoria",
    description: "Residential landscaping in Central Saanich, from Keating to Saanichton, with lawn care, garden bed maintenance, and property upkeep designed for clean, well-kept homes. It is a good fit for larger yards, quieter residential pockets, and properties that need dependable seasonal attention.",
    neighborhoods: ["Saanichton", "Keating", "Brentwood Bay"],
    nearbyAreas: ["saanich", "north-saanich", "brentwood-bay"],
    localLandmarks: ["Island View Beach", "Butchart Gardens"],
  },
  {
    id: "north-saanich",
    slug: "north-saanich",
    name: "North Saanich",
    region: "Greater Victoria",
    description: "Residential lawn and garden services for North Saanich homes, including maintenance near Sidney, Deep Cove, and the surrounding peninsula communities. It is especially useful for homeowners who want regular service without having to manage the details every time.",
    neighborhoods: ["Deep Cove", "Curteis Point", "Lands End"],
    nearbyAreas: ["central-saanich", "sidney"],
    localLandmarks: ["Victoria International Airport", "Gulf Islands views"],
  },
  {
    id: "brentwood-bay",
    slug: "brentwood-bay",
    name: "Brentwood Bay",
    region: "Greater Victoria",
    description: "Residential landscaping in Brentwood Bay for waterfront and hillside homes that need dependable lawn care, garden maintenance, and seasonal refresh work. The page is a fit for homeowners near Butchart Gardens and the village core who want tidy, repeatable service.",
    nearbyAreas: ["central-saanich", "saanich"],
    localLandmarks: ["Butchart Gardens", "Brentwood Bay Village"],
  },
  {
    id: "sidney",
    slug: "sidney",
    name: "Sidney",
    region: "Greater Victoria",
    description: "Residential landscaping in Sidney-by-the-Sea for homeowners who want regular mowing, seasonal cleanups, and garden care with clear communication and tidy results.",
    nearbyAreas: ["north-saanich", "central-saanich"],
    localLandmarks: ["Sidney waterfront", "BC Ferries terminal"],
  },
  {
    id: "langford",
    slug: "langford",
    name: "Langford",
    region: "Greater Victoria",
    description: "Residential lawn care and landscaping throughout Langford, from Happy Valley to Bear Mountain, with reliable mowing, trimming, and seasonal maintenance for busy homeowners who want fast quotes and a tidy finish.",
    neighborhoods: ["Happy Valley", "Bear Mountain", "Goldstream", "Florence Lake"],
    nearbyAreas: ["colwood", "view-royal", "highlands", "metchosin"],
    localLandmarks: ["Goldstream Park", "Bear Mountain"],
  },
  {
    id: "colwood",
    slug: "colwood",
    name: "Colwood",
    region: "Greater Victoria",
    description: "Residential landscaping for Colwood homeowners, from Royal Bay to Hatley Park, with lawn maintenance, garden care, and property upkeep that stays tidy and easy to manage. It is a practical fit for families who want reliable scheduling and a cleaner front approach.",
    neighborhoods: ["Royal Bay", "Hatley Park", "Colwood Corners"],
    nearbyAreas: ["langford", "view-royal", "esquimalt", "metchosin"],
    localLandmarks: ["Fort Rodd Hill", "Royal Roads University"],
  },
  {
    id: "view-royal",
    slug: "view-royal",
    name: "View Royal",
    region: "Greater Victoria",
    description: "Residential landscaping in View Royal with lawn mowing, hedge trimming, and seasonal cleanups for homes throughout this centrally located community. The page works best for homeowners who want simple recurring care and quick help before the property gets out of hand.",
    nearbyAreas: ["colwood", "langford", "esquimalt", "saanich"],
    localLandmarks: ["Thetis Lake", "View Royal Casino area"],
  },
  {
    id: "esquimalt",
    slug: "esquimalt",
    name: "Esquimalt",
    region: "Greater Victoria",
    description: "Residential lawn care and landscaping in Esquimalt, with mowing, garden maintenance, and cleanup services for homeowners who want a neat, dependable result. It is a good match for smaller yards, periodic resets, and homeowners who want a predictable quote process.",
    nearbyAreas: ["victoria", "view-royal", "colwood"],
    localLandmarks: ["CFB Esquimalt", "Gorge Waterway"],
  },
  {
    id: "sooke",
    slug: "sooke",
    name: "Sooke",
    region: "Greater Victoria",
    description: "Residential landscaping in Sooke, from East Sooke to Otter Point, with reliable lawn care, brush clearing, and property maintenance for rural and residential lots. It is especially useful where bigger yards need heavier upkeep and a practical crew that can handle the messy parts.",
    neighborhoods: ["East Sooke", "Otter Point", "Saseenos"],
    nearbyAreas: ["metchosin", "langford"],
    localLandmarks: ["Sooke Potholes", "Whiffin Spit"],
  },
  {
    id: "metchosin",
    slug: "metchosin",
    name: "Metchosin",
    region: "Greater Victoria",
    description: "Landscaping and property maintenance in rural Metchosin for acreages and residential properties that need lawn care, brush clearing, and seasonal service tailored to larger lots. This page fits homeowners who want acreage-friendly maintenance without overcomplicating the quote.",
    nearbyAreas: ["colwood", "langford", "sooke"],
    localLandmarks: ["Witty's Lagoon", "Metchosin Village"],
  },
  {
    id: "highlands",
    slug: "highlands",
    name: "Highlands",
    region: "Greater Victoria",
    description: "Professional property maintenance in the Highlands for larger rural lots that need lawn care, brush clearing, and seasonal cleanups with a practical approach. It is a strong fit for owners who value clear communication and straightforward scheduling over flashy extras.",
    nearbyAreas: ["langford", "view-royal", "saanich"],
    localLandmarks: ["Thetis Lake Regional Park", "Highlands recreation"],
  },
  // Cowichan Valley
  {
    id: "shawnigan-lake",
    slug: "shawnigan-lake",
    name: "Shawnigan Lake",
    region: "Cowichan Valley",
    description: "Based in Shawnigan Lake, we provide residential landscaping for homeowners who need reliable lawn care, garden maintenance, and seasonal service throughout the lake community. It is a strong fit for regular upkeep, seasonal resets, and properties that need dependable local scheduling.",
    neighborhoods: ["West Shawnigan", "South Shawnigan", "Village"],
    nearbyAreas: ["mill-bay", "cobble-hill"],
    localLandmarks: ["Shawnigan Lake", "Kinsol Trestle"],
  },
  {
    id: "mill-bay",
    slug: "mill-bay",
    name: "Mill Bay",
    region: "Cowichan Valley",
    description: "Residential landscaping in Mill Bay for waterfront and hillside homes that need reliable lawn care, garden maintenance, and seasonal cleanup work. It is a strong fit for homes that need dependable local scheduling and cleaner curb appeal between larger projects.",
    nearbyAreas: ["shawnigan-lake", "cobble-hill", "brentwood-bay"],
    localLandmarks: ["Mill Bay Ferry", "Brentwood-Mill Bay Ferry"],
  },
  {
    id: "cobble-hill",
    slug: "cobble-hill",
    name: "Cobble Hill",
    region: "Cowichan Valley",
    description: "Lawn care and landscaping in Cobble Hill for residential properties that need professional mowing, trimming, and garden services with a clean finish. The page is aimed at homeowners who want tidy recurring maintenance without having to manage every detail themselves.",
    nearbyAreas: ["shawnigan-lake", "mill-bay", "cowichan-bay"],
    localLandmarks: ["Cobble Hill Village", "Local wineries"],
  },
  {
    id: "cowichan-bay",
    slug: "cowichan-bay",
    name: "Cowichan Bay",
    region: "Cowichan Valley",
    description: "Residential landscaping in Cowichan Bay, with lawn care, garden maintenance, and seasonal cleanups for waterfront homes and surrounding properties. It works well for homeowners who want a local crew that understands seasonal buildup and property presentation near the village and waterfront.",
    nearbyAreas: ["cobble-hill", "duncan"],
    localLandmarks: ["Cowichan Bay Village", "Maritime Centre"],
  },
  {
    id: "maple-bay",
    slug: "maple-bay",
    name: "Maple Bay",
    region: "Cowichan Valley",
    description: "Landscaping services in Maple Bay for marina-area homes and properties along Maple Bay Road that need reliable lawn care and garden maintenance. It is a useful page for homes that need small-lot upkeep, driveway refresh work, or seasonal cleanup support.",
    nearbyAreas: ["duncan", "cowichan-bay"],
    localLandmarks: ["Maple Bay Marina", "Maple Mountain"],
  },
  {
    id: "lake-cowichan",
    slug: "lake-cowichan",
    name: "Lake Cowichan",
    region: "Cowichan Valley",
    description: "Residential landscaping in Lake Cowichan for homes around the lake and surrounding community that need lawn care, property maintenance, and seasonal service. The page is a fit for homeowners who want a practical local crew for regular upkeep and bigger seasonal resets.",
    nearbyAreas: ["duncan"],
    localLandmarks: ["Cowichan Lake", "Kaatza Station Museum"],
  },
  {
    id: "duncan",
    slug: "duncan",
    name: "Duncan",
    region: "Cowichan Valley",
    description: "Professional lawn care and landscaping in Duncan, the City of Totems, for residential properties that need mowing, garden maintenance, seasonal cleanups, and ongoing property care from a local residential crew. It is designed for homeowners who want straightforward service and reliable follow-through.",
    neighborhoods: ["Downtown", "Gibbins Road", "Trunk Road", "Beverly Street"],
    nearbyAreas: ["cowichan-bay", "maple-bay", "lake-cowichan", "cobble-hill"],
    localLandmarks: ["Downtown Totem Poles", "Cowichan Valley Trail"],
  },
];

export const regions: Region[] = [
  {
    id: "greater-victoria",
    name: "Greater Victoria",
    description: "Professional residential landscaping services throughout the Capital Regional District, including lawn maintenance, garden bed care, seasonal cleanups, and property upkeep. The region page connects the city pages to the core service pages and helps visitors quickly find the right local fit.",
    locationIds: locations.filter((l) => l.region === "Greater Victoria").map((l) => l.id),
  },
  {
    id: "cowichan-valley",
    name: "Cowichan Valley",
    description: "Reliable lawn care and landscaping for homes across the Cowichan Valley, from Shawnigan Lake to Duncan. We provide weekly mowing, trimming, mulching, and seasonal yard maintenance for homeowners who want a local crew that keeps things simple and tidy.",
    locationIds: locations.filter((l) => l.region === "Cowichan Valley").map((l) => l.id),
  },
];

export const getLocationBySlug = (slug: string): Location | undefined =>
  locations.find((l) => l.slug === slug);

export const getLocationById = (id: string): Location | undefined =>
  locations.find((l) => l.id === id);

export const getLocationsByRegion = (regionName: RegionName): Location[] =>
  locations.filter((l) => l.region === regionName);

export const getRegionByName = (name: RegionName): Region | undefined =>
  regions.find((r) => r.name === name);

export const locationNames = locations.map((l) => l.name);
