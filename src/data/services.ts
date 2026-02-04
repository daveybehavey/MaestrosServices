export interface Service {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  description: string;
  longDescription: string;
  features: string[];
  faqs: Array<{ question: string; answer: string }>;
  relatedServices: string[];
  seasonalRelevance: ("spring" | "summer" | "fall" | "winter")[];
}

export const services: Service[] = [
  {
    id: "lawn-mowing",
    slug: "lawn-mowing",
    name: "Lawn Mowing and Clean Edging",
    shortName: "Lawn Mowing",
    description: "Professional lawn mowing and crisp edging to keep your yard looking sharp all season long.",
    longDescription: "Our lawn mowing service delivers consistent, professional results that keep your property looking its best. We use quality equipment to ensure clean cuts at the optimal height for your grass type, paired with precise edging along walkways, driveways, and garden beds for that finished look.",
    features: [
      "Precision mowing at optimal cutting height",
      "Clean edging along walkways and driveways",
      "Trimming around obstacles and garden beds",
      "Clipping collection or mulching options",
      "Weekly and bi-weekly scheduling available",
    ],
    faqs: [
      {
        question: "How often should my lawn be mowed?",
        answer: "During the growing season, most lawns on Vancouver Island benefit from weekly mowing. Bi-weekly works well for slower-growing lawns or during dry periods.",
      },
      {
        question: "Do you bag the grass clippings?",
        answer: "We can bag and remove clippings, or mulch them back into the lawn. Mulching returns nutrients to the soil and is often the healthier choice.",
      },
    ],
    relatedServices: ["weed-control", "seasonal-cleanups"],
    seasonalRelevance: ["spring", "summer", "fall"],
  },
  {
    id: "hedge-trimming",
    slug: "hedge-trimming",
    name: "Hedge, Shrub, and Small Tree Trimming",
    shortName: "Hedge Trimming",
    description: "Keep hedges, shrubs, and small trees shaped and healthy with professional trimming services.",
    longDescription: "Overgrown hedges and shrubs can make even a well-maintained property look neglected. Our trimming service restores clean lines and promotes healthy growth, whether you need formal shaping or natural maintenance cuts.",
    features: [
      "Hedge shaping and maintenance trimming",
      "Shrub pruning and rejuvenation",
      "Small tree trimming (up to 15 feet)",
      "Debris cleanup and removal included",
      "Seasonal timing recommendations",
    ],
    faqs: [
      {
        question: "When is the best time to trim hedges?",
        answer: "Most hedges do best with trimming in late spring after new growth, and again in late summer. We can advise on timing for your specific plants.",
      },
      {
        question: "Can you handle overgrown hedges?",
        answer: "Yes, we can bring overgrown hedges back under control. Severe rejuvenation pruning may require multiple sessions spaced over a season.",
      },
    ],
    relatedServices: ["garden-bed-maintenance", "seasonal-cleanups"],
    seasonalRelevance: ["spring", "summer", "fall"],
  },
  {
    id: "garden-bed-maintenance",
    slug: "garden-bed-maintenance",
    name: "Garden Bed Refresh and Mulching",
    shortName: "Garden Beds",
    description: "Refresh your garden beds with weeding, edging, and fresh mulch for a polished look.",
    longDescription: "Garden beds are often the first thing people notice about a property. Our refresh service includes thorough weeding, bed edge definition, soil amendment if needed, and fresh mulch application to suppress weeds and retain moisture.",
    features: [
      "Thorough weeding and debris removal",
      "Bed edge definition and cleanup",
      "Quality mulch application (2-3 inch depth)",
      "Soil amendment recommendations",
      "Plant health assessment",
    ],
    faqs: [
      {
        question: "What type of mulch do you use?",
        answer: "We typically use bark mulch or wood chips, but can accommodate preferences for decorite, river rock, or other materials. Let us know your preference.",
      },
      {
        question: "How often should mulch be refreshed?",
        answer: "Most beds benefit from a fresh layer annually, usually in spring. High-traffic or sunny areas may need a mid-season top-up.",
      },
    ],
    relatedServices: ["weed-control", "seasonal-cleanups"],
    seasonalRelevance: ["spring", "summer", "fall"],
  },
  {
    id: "seasonal-cleanups",
    slug: "seasonal-cleanups",
    name: "Seasonal Cleanups (Spring and Fall)",
    shortName: "Seasonal Cleanups",
    description: "Comprehensive spring wake-ups and fall resets to prepare your yard for the changing seasons.",
    longDescription: "Seasonal transitions are critical times for your yard. Our spring cleanup removes winter debris and prepares beds for the growing season, while fall cleanup clears leaves, cuts back perennials, and protects your landscape through winter.",
    features: [
      "Leaf and debris removal",
      "Perennial cutback and bed preparation",
      "Lawn dethatching and aeration available",
      "Gutter clearing (ground-accessible)",
      "Complete property walkthrough",
    ],
    faqs: [
      {
        question: "What's included in a seasonal cleanup?",
        answer: "Standard cleanups include debris removal, leaf clearing, bed tidying, and a general property walkthrough. We can add services like dethatching or gutter clearing as needed.",
      },
      {
        question: "When should I schedule spring/fall cleanup?",
        answer: "Spring cleanup is best in March-April as growth begins. Fall cleanup works best in October-November after most leaves have dropped.",
      },
    ],
    relatedServices: ["lawn-mowing", "garden-bed-maintenance", "yard-waste-removal"],
    seasonalRelevance: ["spring", "fall"],
  },
  {
    id: "weed-control",
    slug: "weed-control",
    name: "Weed Control and Tidy-Ups",
    shortName: "Weed Control",
    description: "Keep weeds under control with regular maintenance and targeted removal throughout the season.",
    longDescription: "Weeds compete with your plants for water and nutrients, and can quickly take over if left unchecked. Our weed control service includes manual removal, mulch application to suppress regrowth, and regular maintenance visits to keep your property looking its best.",
    features: [
      "Manual weed removal (no harsh chemicals)",
      "Pathway and driveway crack weeding",
      "Preventive mulching strategies",
      "Regular maintenance scheduling",
      "Invasive species identification",
    ],
    faqs: [
      {
        question: "Do you use herbicides?",
        answer: "We focus on manual removal and prevention through mulching. If chemical treatment is needed, we can discuss options and always prioritize safety.",
      },
      {
        question: "How often should weed control be done?",
        answer: "During peak growing season, bi-weekly visits work well. Monthly maintenance can suffice for well-mulched properties with fewer weed pressures.",
      },
    ],
    relatedServices: ["garden-bed-maintenance", "lawn-mowing"],
    seasonalRelevance: ["spring", "summer", "fall"],
  },
  {
    id: "yard-waste-removal",
    slug: "yard-waste-removal",
    name: "Yard Waste Haul-Away",
    shortName: "Yard Waste Removal",
    description: "We remove and properly dispose of all yard waste, leaving your property clean and clear.",
    longDescription: "Don't let piles of yard waste clutter your property. We haul away everything from grass clippings and leaves to branches and garden debris. All waste is disposed of responsibly at local green waste facilities.",
    features: [
      "Green waste and debris removal",
      "Branch and brush hauling",
      "Post-project cleanup",
      "Responsible disposal at certified facilities",
      "Same-day removal available",
    ],
    faqs: [
      {
        question: "What can you haul away?",
        answer: "We handle all organic yard waste: grass, leaves, branches, shrub trimmings, and garden debris. We cannot take construction materials, treated wood, or hazardous waste.",
      },
      {
        question: "Is yard waste disposal included in regular service?",
        answer: "Small amounts from regular maintenance are included. Large cleanups or one-time hauls may have an additional disposal fee based on volume.",
      },
    ],
    relatedServices: ["seasonal-cleanups", "brush-clearing"],
    seasonalRelevance: ["spring", "summer", "fall", "winter"],
  },
  {
    id: "brush-clearing",
    slug: "brush-clearing",
    name: "Small Brush Clearing",
    shortName: "Brush Clearing",
    description: "Clear overgrown areas and small brush to reclaim usable space on your property.",
    longDescription: "Overgrown corners and neglected areas can harbor pests and look unkempt. Our brush clearing service tackles blackberry, salal, and other invasive growth to restore usable space and improve the overall appearance of your property.",
    features: [
      "Blackberry and invasive plant removal",
      "Undergrowth clearing",
      "Property line cleanup",
      "Fire hazard reduction",
      "Debris removal included",
    ],
    faqs: [
      {
        question: "Can you clear blackberry bushes?",
        answer: "Yes, blackberry removal is one of our most requested services. We cut back growth and remove root systems where accessible to slow regrowth.",
      },
      {
        question: "Do you handle large tree removal?",
        answer: "Not yet. We handle shrubs, hedges, and small trees, but large tree felling requires specialized equipment and certification we don't currently offer.",
      },
    ],
    relatedServices: ["yard-waste-removal", "seasonal-cleanups"],
    seasonalRelevance: ["spring", "summer", "fall", "winter"],
  },
  {
    id: "driveway-grading",
    slug: "driveway-grading",
    name: "Driveway Grading and Re-Leveling",
    shortName: "Driveway Grading",
    description: "Improve drainage and driveway performance with professional grading and re-leveling.",
    longDescription: "Ruts, pooling water, and washboard surfaces can shorten driveway life and create ongoing maintenance headaches. Our driveway grading service reshapes and compacts gravel and aggregate surfaces for better drainage, smoother access, and a cleaner finish.",
    features: [
      "Driveway re-leveling and crown correction",
      "Rut and pothole repair with fresh aggregate",
      "Drainage-focused slope adjustments",
      "Compaction for longer-lasting surface stability",
      "Optional tie-in with nearby pathway grading",
    ],
    faqs: [
      {
        question: "Do you grade existing gravel driveways?",
        answer: "Yes. We re-grade existing driveways to correct ruts, improve runoff, and restore a smoother driving surface.",
      },
      {
        question: "Can you help with recurring puddles and soft spots?",
        answer: "Absolutely. We adjust surface slope and can add aggregate in problem areas to reduce pooling and improve stability.",
      },
    ],
    relatedServices: ["gravel-driveway-installation", "yard-waste-removal", "brush-clearing"],
    seasonalRelevance: ["spring", "summer", "fall"],
  },
  {
    id: "gravel-driveway-installation",
    slug: "gravel-driveway-installation",
    name: "Gravel Driveway Installation and Refresh",
    shortName: "Gravel Driveways",
    description: "Build or refresh gravel driveways with proper base prep, aggregate placement, and finishing.",
    longDescription: "Whether you're upgrading an older surface or adding a new gravel section, we provide practical driveway installation and refresh work tailored to your property. We focus on durable base preparation, clean edges, and even aggregate distribution for a strong, professional result.",
    features: [
      "New gravel driveway installation (small to mid-size projects)",
      "Surface refresh with fresh aggregate top-up",
      "Base prep and leveling before placement",
      "Edge cleanup and driveway border definition",
      "Final grading for runoff and access",
    ],
    faqs: [
      {
        question: "Do you handle complete driveway rebuilds?",
        answer: "We handle many small to mid-size rebuild and refresh projects. For larger engineered installations, we can assess and confirm scope during quoting.",
      },
      {
        question: "What gravel type do you recommend?",
        answer: "We typically recommend locally available crushed aggregate suited to your traffic and drainage needs, then adjust based on your budget and finish preference.",
      },
    ],
    relatedServices: ["driveway-grading", "yard-waste-removal", "weed-control"],
    seasonalRelevance: ["spring", "summer", "fall"],
  },
];

export const getServiceBySlug = (slug: string): Service | undefined =>
  services.find((s) => s.slug === slug);

export const getServiceById = (id: string): Service | undefined =>
  services.find((s) => s.id === id);

export const serviceNames = services.map((s) => s.name);
