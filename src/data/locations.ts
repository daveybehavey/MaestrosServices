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
    description: "Professional residential landscaping services in Victoria, BC. From James Bay to Fernwood, we provide reliable lawn care, garden maintenance, and seasonal cleanups for homeowners across the capital city.",
    neighborhoods: ["James Bay", "Fairfield", "Oak Bay", "Fernwood", "Rockland", "Gonzales", "Hillside"],
    nearbyAreas: ["saanich", "esquimalt", "oak-bay"],
    localLandmarks: ["Beacon Hill Park", "Inner Harbour", "Government Street"],
  },
  {
    id: "saanich",
    slug: "saanich",
    name: "Saanich",
    region: "Greater Victoria",
    description: "Lawn care and landscaping services throughout Saanich. We serve residential properties from Gordon Head to Royal Oak, providing mowing, trimming, cleanups, and ongoing maintenance.",
    neighborhoods: ["Gordon Head", "Cadboro Bay", "Royal Oak", "Broadmead", "Cordova Bay", "Shelbourne"],
    nearbyAreas: ["victoria", "central-saanich", "oak-bay"],
    localLandmarks: ["Mount Douglas Park", "University of Victoria"],
  },
  {
    id: "central-saanich",
    slug: "central-saanich",
    name: "Central Saanich",
    region: "Greater Victoria",
    description: "Residential landscaping in Central Saanich, from Keating to Saanichton. We provide professional lawn care, garden bed maintenance, and property upkeep for homes in this scenic peninsula community.",
    neighborhoods: ["Saanichton", "Keating", "Brentwood Bay"],
    nearbyAreas: ["saanich", "north-saanich", "brentwood-bay"],
    localLandmarks: ["Island View Beach", "Butchart Gardens"],
  },
  {
    id: "north-saanich",
    slug: "north-saanich",
    name: "North Saanich",
    region: "Greater Victoria",
    description: "Professional lawn and garden services for North Saanich homes. We maintain residential properties near Sidney, Deep Cove, and throughout this beautiful peninsula community.",
    neighborhoods: ["Deep Cove", "Curteis Point", "Lands End"],
    nearbyAreas: ["central-saanich", "sidney"],
    localLandmarks: ["Victoria International Airport", "Gulf Islands views"],
  },
  {
    id: "brentwood-bay",
    slug: "brentwood-bay",
    name: "Brentwood Bay",
    region: "Greater Victoria",
    description: "Landscaping services in Brentwood Bay and surrounding areas. From waterfront properties to hillside homes, we provide reliable lawn care and garden maintenance year-round.",
    nearbyAreas: ["central-saanich", "saanich"],
    localLandmarks: ["Butchart Gardens", "Brentwood Bay Village"],
  },
  {
    id: "sidney",
    slug: "sidney",
    name: "Sidney",
    region: "Greater Victoria",
    description: "Residential landscaping services in Sidney-by-the-Sea. We help homeowners maintain beautiful yards with regular mowing, seasonal cleanups, and garden care throughout this charming seaside town.",
    nearbyAreas: ["north-saanich", "central-saanich"],
    localLandmarks: ["Sidney waterfront", "BC Ferries terminal"],
  },
  {
    id: "langford",
    slug: "langford",
    name: "Langford",
    region: "Greater Victoria",
    description: "Professional lawn care and landscaping throughout Langford. From Happy Valley to Bear Mountain, we serve residential properties with reliable mowing, trimming, and seasonal maintenance.",
    neighborhoods: ["Happy Valley", "Bear Mountain", "Goldstream", "Florence Lake"],
    nearbyAreas: ["colwood", "view-royal", "highlands", "metchosin"],
    localLandmarks: ["Goldstream Park", "Bear Mountain"],
  },
  {
    id: "colwood",
    slug: "colwood",
    name: "Colwood",
    region: "Greater Victoria",
    description: "Landscaping services for Colwood homeowners. We provide professional lawn maintenance, garden care, and property upkeep from Royal Bay to Hatley Park and throughout the community.",
    neighborhoods: ["Royal Bay", "Hatley Park", "Colwood Corners"],
    nearbyAreas: ["langford", "view-royal", "esquimalt", "metchosin"],
    localLandmarks: ["Fort Rodd Hill", "Royal Roads University"],
  },
  {
    id: "view-royal",
    slug: "view-royal",
    name: "View Royal",
    region: "Greater Victoria",
    description: "Residential landscaping in View Royal. Our services include lawn mowing, hedge trimming, and seasonal cleanups for homes throughout this centrally-located community.",
    nearbyAreas: ["colwood", "langford", "esquimalt", "saanich"],
    localLandmarks: ["Thetis Lake", "View Royal Casino area"],
  },
  {
    id: "esquimalt",
    slug: "esquimalt",
    name: "Esquimalt",
    region: "Greater Victoria",
    description: "Lawn care and landscaping services in Esquimalt. We maintain residential properties with professional mowing, garden maintenance, and cleanup services throughout this historic naval community.",
    nearbyAreas: ["victoria", "view-royal", "colwood"],
    localLandmarks: ["CFB Esquimalt", "Gorge Waterway"],
  },
  {
    id: "sooke",
    slug: "sooke",
    name: "Sooke",
    region: "Greater Victoria",
    description: "Professional landscaping services in Sooke. From East Sooke to Otter Point, we provide reliable lawn care, brush clearing, and property maintenance for rural and residential properties.",
    neighborhoods: ["East Sooke", "Otter Point", "Saseenos"],
    nearbyAreas: ["metchosin", "langford"],
    localLandmarks: ["Sooke Potholes", "Whiffin Spit"],
  },
  {
    id: "metchosin",
    slug: "metchosin",
    name: "Metchosin",
    region: "Greater Victoria",
    description: "Landscaping and property maintenance in rural Metchosin. We serve acreages and residential properties with lawn care, brush clearing, and seasonal services suited to larger properties.",
    nearbyAreas: ["colwood", "langford", "sooke"],
    localLandmarks: ["Witty's Lagoon", "Metchosin Village"],
  },
  {
    id: "highlands",
    slug: "highlands",
    name: "Highlands",
    region: "Greater Victoria",
    description: "Professional property maintenance in the Highlands. We provide landscaping services suited to larger rural properties, including lawn care, brush clearing, and seasonal cleanups.",
    nearbyAreas: ["langford", "view-royal", "saanich"],
    localLandmarks: ["Thetis Lake Regional Park", "Highlands recreation"],
  },
  // Cowichan Valley
  {
    id: "shawnigan-lake",
    slug: "shawnigan-lake",
    name: "Shawnigan Lake",
    region: "Cowichan Valley",
    description: "Based in Shawnigan Lake, we're your local landscaping experts. We provide professional lawn care, garden maintenance, and seasonal services to residential properties throughout the lake community.",
    neighborhoods: ["West Shawnigan", "South Shawnigan", "Village"],
    nearbyAreas: ["mill-bay", "cobble-hill"],
    localLandmarks: ["Shawnigan Lake", "Kinsol Trestle"],
  },
  {
    id: "mill-bay",
    slug: "mill-bay",
    name: "Mill Bay",
    region: "Cowichan Valley",
    description: "Residential landscaping services in Mill Bay. From waterfront properties to hillside homes, we provide reliable lawn care, garden maintenance, and seasonal cleanups.",
    nearbyAreas: ["shawnigan-lake", "cobble-hill", "brentwood-bay"],
    localLandmarks: ["Mill Bay Ferry", "Brentwood-Mill Bay Ferry"],
  },
  {
    id: "cobble-hill",
    slug: "cobble-hill",
    name: "Cobble Hill",
    region: "Cowichan Valley",
    description: "Lawn care and landscaping in Cobble Hill. We maintain residential properties with professional mowing, trimming, and garden services throughout this charming village and surrounding areas.",
    nearbyAreas: ["shawnigan-lake", "mill-bay", "cowichan-bay"],
    localLandmarks: ["Cobble Hill Village", "Local wineries"],
  },
  {
    id: "cowichan-bay",
    slug: "cowichan-bay",
    name: "Cowichan Bay",
    region: "Cowichan Valley",
    description: "Professional landscaping in Cowichan Bay. We serve this scenic waterfront community with lawn care, garden maintenance, and seasonal cleanups for residential properties.",
    nearbyAreas: ["cobble-hill", "duncan"],
    localLandmarks: ["Cowichan Bay Village", "Maritime Centre"],
  },
  {
    id: "maple-bay",
    slug: "maple-bay",
    name: "Maple Bay",
    region: "Cowichan Valley",
    description: "Landscaping services in Maple Bay. From marina-area homes to properties along Maple Bay Road, we provide reliable lawn care and garden maintenance services.",
    nearbyAreas: ["duncan", "cowichan-bay"],
    localLandmarks: ["Maple Bay Marina", "Maple Mountain"],
  },
  {
    id: "lake-cowichan",
    slug: "lake-cowichan",
    name: "Lake Cowichan",
    region: "Cowichan Valley",
    description: "Residential landscaping in Lake Cowichan. We provide lawn care, property maintenance, and seasonal services to homes around the lake and in the surrounding community.",
    nearbyAreas: ["duncan"],
    localLandmarks: ["Cowichan Lake", "Kaatza Station Museum"],
  },
  {
    id: "duncan",
    slug: "duncan",
    name: "Duncan",
    region: "Cowichan Valley",
    description: "Professional lawn care and landscaping in Duncan, the City of Totems. We serve residential properties throughout Duncan with mowing, garden maintenance, seasonal cleanups, and ongoing property care.",
    neighborhoods: ["Downtown", "Gibbins Road", "Trunk Road", "Beverly Street"],
    nearbyAreas: ["cowichan-bay", "maple-bay", "lake-cowichan", "cobble-hill"],
    localLandmarks: ["Downtown Totem Poles", "Cowichan Valley Trail"],
  },
];

export const regions: Region[] = [
  {
    id: "greater-victoria",
    name: "Greater Victoria",
    description: "Professional residential landscaping services throughout the Capital Regional District, including lawn maintenance, garden bed care, seasonal cleanups, and property upkeep.",
    locationIds: locations.filter((l) => l.region === "Greater Victoria").map((l) => l.id),
  },
  {
    id: "cowichan-valley",
    name: "Cowichan Valley",
    description: "Reliable lawn care and landscaping for homes across the Cowichan Valley, from Shawnigan Lake to Duncan. We provide weekly mowing, trimming, mulching, and seasonal yard maintenance.",
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
