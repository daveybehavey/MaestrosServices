export interface Service {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  description: string;
  longDescription: string;
  features: string[];
  faqs: Array<{ question: string; answer: string }>;
  beforeAfterScenarios?: Array<{
    before: string;
    after: string;
    result: string;
  }>;
  relatedServices: string[];
  seasonalRelevance: ("spring" | "summer" | "fall" | "winter")[];
}

export const services: Service[] = [
  {
    id: "lawn-mowing",
    slug: "lawn-mowing",
    name: "Lawn Mowing and Clean Edging",
    shortName: "Lawn Mowing",
    description: "Residential lawn mowing and crisp edging for homeowners who want a clean, well-kept yard all season on Vancouver Island.",
    longDescription: "Our lawn mowing service is built for homeowners who want dependable upkeep, neat edges, and a clean finish without the hassle. We use quality equipment to cut at the right height for your grass, then edge walkways, driveways, and beds so the property looks cared for from the street. It is a strong fit for recurring curb appeal maintenance and one-off resets before guests, listings, or seasonal changes, especially on properties that need a tidy front yard without a full landscape overhaul.",
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
    relatedServices: ["weed-control", "seasonal-cleanups", "garden-bed-maintenance"],
    seasonalRelevance: ["spring", "summer", "fall"],
  },
  {
    id: "hedge-trimming",
    slug: "hedge-trimming",
    name: "Hedge, Shrub, and Small Tree Trimming",
    shortName: "Hedge Trimming",
    description: "Residential hedge trimming for clean lines, healthier growth, and a sharper first impression on Vancouver Island.",
    longDescription: "Overgrown hedges and shrubs can make a property look neglected even when the rest of the yard is in good shape. Our trimming service restores clean lines, improves plant health, and keeps entryways, driveways, and bed edges looking intentional. Homeowners use this service when they want a tidy front yard, better light, and a cleaner boundary around the property. It is especially useful for front hedges, fence lines, and privacy screens that need to look sharp from the street.",
    features: [
      "Hedge shaping and maintenance trimming",
      "Shrub pruning and rejuvenation",
      "Small tree trimming (up to 15 feet)",
      "Debris cleanup and removal included",
      "Seasonal timing recommendations for Vancouver Island growth cycles",
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
    name: "Mulching and Garden Bed Refresh",
    shortName: "Mulching and Garden Beds",
    description:
      "Mulch installation and garden bed refresh work for cleaner beds, better moisture retention, and less weed pressure.",
    longDescription:
      "Fresh mulch and sharp bed edges make an immediate difference in curb appeal while helping reduce weekly maintenance. Our mulching and bed refresh service includes weeding, edge cleanup, and mulch installation or top-ups to help hold moisture and slow regrowth through the season. It is a practical choice for homeowners who want a front-yard refresh without replacing plantings or rebuilding beds.",
    features: [
      "Fresh mulch installation and seasonal top-ups (2-3 inch depth)",
      "Bed edge definition and cleanup",
      "Thorough weeding and debris removal",
      "Soil and planting condition check",
      "Material recommendations based on look and budget",
    ],
      faqs: [
        {
          question: "What type of mulch do you install?",
          answer:
            "We typically install bark mulch or wood chips, and can also source decorite, river rock, or other bed materials based on your preference and budget.",
        },
        {
          question: "How often should mulch be topped up?",
          answer:
            "Most beds benefit from one fresh layer each year, usually in spring. Sunny or higher-traffic areas may need a smaller top-up later in the season.",
        },
        {
          question: "Can you help me choose between bark mulch, wood chips, or decorite?",
          answer:
            "Yes. We can walk through the look, upkeep, and budget tradeoffs. Bark mulch is a common curb-appeal choice, wood chips can be practical in some areas, and decorite or other stone options may make sense where lower seasonal top-up is the priority.",
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
    description: "Spring and fall cleanup service for homeowners who want a reset before weather changes on Vancouver Island.",
    longDescription: "Seasonal transitions are when a yard can either stay tidy or fall behind fast. Our spring cleanup removes winter debris and prepares beds for the growing season, while fall cleanup clears leaves, cuts back perennials, and gets the property ready for winter. It is one of the best ways to get the whole property back under control without piecing together several separate visits, especially if you want a cleaner yard before guests, photos, or a seasonal changeover.",
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
        {
          question: "How do I know if I need a full cleanup or just a few smaller services?",
          answer: "If several areas of the property feel behind at once, a cleanup is usually the simpler route. If the issue is only one bed, one hedge, or one isolated task, we can tell you that too and recommend the leaner option.",
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
    description: "Keep weeds under control with regular maintenance and targeted removal throughout the season on Vancouver Island.",
    longDescription: "Weeds compete with your plants for water and nutrients, and can quickly take over if left unchecked. Our weed control service includes manual removal, mulch application to suppress regrowth, and regular maintenance visits to keep your property looking its best. It works especially well as part of a larger bed maintenance plan or seasonal refresh, and it helps front beds, pathways, and driveway edges stay cleaner between visits.",
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
    description: "Residential yard waste haul-away for homeowners who want piles, branches, and green debris gone fast.",
    longDescription: "Don't let piles of yard waste clutter your property. We haul away everything from grass clippings and leaves to branches and garden debris, then leave the area ready for the next step. It is a practical add-on after cleanups, pruning, hedge work, or any project that creates more debris than the homeowner wants to manage.",
    features: [
      "Green waste and debris removal",
      "Branch and brush hauling",
      "Post-project cleanup",
      "Responsible disposal at certified facilities",
      "Same-day removal available when routes allow",
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
    relatedServices: ["seasonal-cleanups", "brush-clearing", "garden-bed-maintenance"],
    seasonalRelevance: ["spring", "summer", "fall", "winter"],
  },
  {
    id: "brush-clearing",
    slug: "brush-clearing",
    name: "Small Brush Clearing",
    shortName: "Brush Clearing",
    description: "Clear overgrown areas and small brush to reclaim usable space on your property in a residential-friendly way.",
    longDescription: "Overgrown corners and neglected areas can harbor pests and look unkempt. Our brush clearing service tackles blackberry, salal, and other invasive growth to restore usable space and improve the overall appearance of your property. It is especially helpful for fence lines, side yards, back corners, and access paths that got away from regular maintenance.",
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
    relatedServices: ["yard-waste-removal", "seasonal-cleanups", "fence-work-minor-repairs"],
    seasonalRelevance: ["spring", "summer", "fall", "winter"],
  },
  {
    id: "gutter-cleaning-ground-access",
    slug: "gutter-cleaning-ground-access",
    name: "Ground-Accessible Gutter Cleaning",
    shortName: "Gutter Cleaning",
    description:
      "Clear leaves and blockages from ground-accessible gutters and downspouts to restore water flow before it turns into a drainage problem.",
    longDescription:
      "Clogged gutters can lead to overflow, staining, and drainage issues around your home. Our ground-accessible gutter cleaning service removes leaf buildup, clears downspout blockages, and checks flow so rainwater moves away from your property as intended. It is a strong seasonal maintenance choice for homes near trees or properties that see heavy rain and debris.",
    features: [
      "Leaf and debris removal from accessible gutters",
      "Downspout clearing and flow check",
      "Bag-up and cleanup of removed debris",
      "Ground-level perimeter check for overflow points",
      "Service limited to safe, ground-accessible rooflines",
    ],
    faqs: [
      {
        question: "Do you clean all roof heights?",
        answer:
          "We focus on safe, ground-accessible rooflines and straightforward access conditions. If your property needs specialized high-access equipment, we can flag that during quoting.",
      },
      {
        question: "How often should gutters be cleaned?",
        answer:
          "Most homes benefit from at least one full clean in fall and another check in winter or spring, especially near mature trees.",
      },
    ],
    relatedServices: ["seasonal-cleanups", "yard-waste-removal", "moss-algae-treatment"],
    seasonalRelevance: ["fall", "winter", "spring"],
  },
  {
    id: "light-pruning",
    slug: "light-pruning",
    name: "Light Pruning and Shape-Ups",
    shortName: "Light Pruning",
    description:
      "Tidy up ornamental shrubs and small plants with light pruning for cleaner shape and healthier growth.",
    longDescription:
      "Light pruning keeps shrubs and ornamental plants looking neat without heavy cutbacks. This service focuses on selective trim work, minor shape correction, and seasonal touch-ups to maintain curb appeal and keep growth manageable. It is a good option when the plant still looks healthy but needs a cleaner outline and a little breathing room.",
    features: [
      "Selective pruning of shrubs and ornamentals",
      "Light shape correction and dead growth removal",
      "Basic clearance around paths and entry points",
      "Debris collection and disposal included",
      "Best for maintenance cuts, not major removals",
    ],
    faqs: [
      {
        question: "How is light pruning different from full hedge trimming?",
        answer:
          "Light pruning is detail-focused maintenance for small shape and health improvements. Full hedge trimming is more intensive and designed for larger resets and line control.",
      },
      {
        question: "Can light pruning be added to regular maintenance visits?",
        answer:
          "Yes. Many clients bundle light pruning with mowing, mulching, and cleanup visits for a full tidy-up.",
      },
    ],
    relatedServices: ["hedge-trimming", "garden-bed-maintenance", "seasonal-cleanups"],
    seasonalRelevance: ["spring", "summer", "fall"],
  },
  {
    id: "moss-algae-treatment",
    slug: "moss-algae-treatment",
    name: "Surface Moss and Algae Treatment",
    shortName: "Moss and Algae Treatment",
    description:
      "Reduce slippery buildup on hard surfaces with surface-safe moss and algae treatment.",
    longDescription:
      "Moss and algae buildup can make pathways, patios, and driveways look dark and become slippery in wet months. Our treatment service targets buildup on exterior surfaces using methods matched to the material, then follows with a clean finish and prevention guidance. It is especially useful for shaded entries, north-facing paths, and damp areas that keep coming back with the same issue.",
    features: [
      "Treatment for moss and algae on hard surfaces",
      "Surface-safe approach by material type",
      "Focus on slip-prone traffic areas",
      "Optional tie-in with power washing service",
      "Post-treatment cleanup and next-step guidance",
    ],
    faqs: [
      {
        question: "Is this the same as power washing?",
        answer:
          "Not exactly. Moss and algae treatment targets biological buildup specifically. It can be done on its own or paired with power washing for a full reset.",
      },
      {
        question: "Where do you usually apply this service?",
        answer:
          "Most requests are for driveways, walkways, patios, and entry zones where slippery growth tends to return through wet seasons.",
      },
    ],
    relatedServices: ["power-washing", "seasonal-cleanups", "gutter-cleaning-ground-access"],
    seasonalRelevance: ["spring", "summer", "fall", "winter"],
  },
  {
    id: "fence-work-minor-repairs",
    slug: "fence-work-minor-repairs",
    name: "Fence Work and Minor Repairs",
    shortName: "Fence Work",
    description:
      "Fence repairs and refresh work for cleaner lines, better function, and a stronger street-facing finish.",
    longDescription:
      "Our fence service focuses on practical residential repair work that improves curb appeal and function without unnecessary complexity. We handle minor panel and post resets where feasible, fence-line cleanup, and straightforward repair work to keep the perimeter looking straight, tidy, and cared for. It is a good fit when the fence is still salvageable but needs a cleaner, safer, more finished look.",
    features: [
      "Fence-line cleanup and vegetation clearing",
      "Minor panel, rail, and hardware repairs",
      "Post and section resets where access allows",
      "Gate alignment and latch tune-up (minor adjustments)",
      "Site cleanup and walkthrough at completion",
    ],
      faqs: [
        {
          question: "Do you build or replace full fence systems?",
          answer:
            "We focus on minor repairs, section fixes, and practical refresh work. For full new fence builds or major structural replacements, we can review scope and recommend the best next step.",
        },
        {
          question: "Can fence work be bundled with other yard services?",
          answer:
            "Yes. Fence work is often paired with mulching, power washing, and rock edging to improve overall curb appeal in one visit.",
        },
        {
          question: "How do I know if my fence is a repair or replacement situation?",
          answer:
            "Photos usually tell us a lot. If the issue is isolated to a few sections, loose hardware, gate alignment, or light leaning, repair may make sense. If failure is widespread or posts are badly compromised, we will tell you early that replacement is the more practical route.",
        },
      ],
    beforeAfterScenarios: [
      {
        before:
          "Fence line had leaning sections, loose hardware, and overgrowth along the base.",
        after:
          "Cleared fence line, reset minor sections, tightened hardware, and cleaned up access edges.",
        result:
          "Straighter appearance, better function, and a cleaner property perimeter from the street.",
      },
      {
        before:
          "Gate closure was inconsistent and one panel line looked uneven near the driveway.",
        after:
          "Adjusted latch and hinges, reset alignment where possible, and completed a cleanup pass.",
        result:
          "More reliable daily use and a sharper first impression at the front approach.",
      },
    ],
    relatedServices: ["power-washing", "rock-work-walls", "garden-bed-maintenance"],
    seasonalRelevance: ["spring", "summer", "fall"],
  },
  {
    id: "power-washing",
    slug: "power-washing",
    name: "Power Washing for Driveways, Patios, and Exteriors",
    shortName: "Power Washing",
    description:
      "Residential power washing for driveways, patios, and exterior surfaces that need a cleaner, fresher finish.",
    longDescription:
      "Our power washing service restores curb appeal by cleaning high-traffic exterior surfaces safely and efficiently. We adjust pressure by surface type, pre-rinse nearby areas, and leave the site tidy so driveways, patios, walkways, and exterior surfaces look fresh without unnecessary wear. It is a strong choice before photos, listing prep, seasonal resets, or when hard surfaces start to look older than they are.",
    features: [
      "Driveway, patio, and walkway washing",
      "Deck, fence, and exterior wall cleaning",
      "Surface-safe pressure adjustment by material",
      "Pre-wet and rinse-down around nearby plants",
      "Post-wash cleanup and finish check",
    ],
      faqs: [
        {
          question: "What surfaces can you power wash?",
          answer:
            "We clean concrete, pavers, stone, vinyl siding, many decks, and most fences. We review each surface first and confirm the right method before starting.",
        },
        {
          question: "Do you use high pressure on every surface?",
          answer:
            "No. We match pressure to the material and use gentler washing where needed to avoid damage while still removing buildup.",
        },
        {
          question: "Will power washing remove every stain completely?",
          answer:
            "Not always. Organic buildup, grime, and surface dirt usually improve well, but some older staining, rust marks, or deeply set discoloration may only improve partially. We would rather set that expectation clearly than overpromise.",
        },
      ],
    beforeAfterScenarios: [
      {
        before:
          "Front entry and driveway had algae staining, dark streaks, and slippery patches after wet weather.",
        after:
          "Washed traffic areas and entry surfaces with pressure set for each material, then rinsed and cleaned the edges.",
        result:
          "Brighter curb appeal, safer footing, and a cleaner first impression from the street.",
      },
      {
        before:
          "Patio and fence lines looked dull with seasonal buildup and embedded dirt.",
        after:
          "Completed a full surface wash and detail pass around corners, joints, and transitions.",
        result:
          "Outdoor living areas looked reset and ready for regular maintenance.",
      },
    ],
    relatedServices: ["seasonal-cleanups", "driveway-grading", "garden-bed-maintenance"],
    seasonalRelevance: ["spring", "summer", "fall"],
  },
  {
    id: "rock-work-walls",
    slug: "rock-work-walls",
    name: "Rock Work and Garden Wall Builds",
    shortName: "Rock Work and Walls",
    description: "Decorative rock work and small garden walls that add structure, edge definition, and curb appeal.",
    longDescription: "Rock features add structure and style when they are installed with the right prep and finish. We build decorative rock accents, bed borders, and small garden walls that improve layout, edge definition, and overall curb appeal while fitting the natural look of Vancouver Island properties. This is a good option when the goal is a cleaner layout rather than a major hardscape project.",
    features: [
      "Decorative rock borders and accent placement",
      "Small dry-stack or mortared garden wall builds",
      "Low retaining edges for beds and walkways",
      "Base prep, leveling, and backfill as needed",
      "Site cleanup and tie-in with surrounding landscaping",
    ],
    faqs: [
      {
        question: "Do you build full engineered retaining walls?",
        answer: "We handle decorative and small functional walls for residential properties. For large engineered retaining walls that require stamped plans, we can review scope and recommend the right specialist.",
      },
      {
        question: "Can you match new rock work to existing landscaping?",
        answer: "Yes. We can source and install materials that complement your existing hardscape and planting style, then adjust layout and finish details during the quote process.",
      },
    ],
    beforeAfterScenarios: [
      {
        before:
          "Slope edge near the driveway was washing out and looked unfinished from the street.",
        after:
          "Installed a low rock wall and reshaped the edge with compacted base and clean transitions.",
        result:
          "Stronger edge definition, less washout after rain, and a more finished look at the front of the property.",
      },
      {
        before:
          "Garden bed borders were uneven and mulch kept spilling into lawn and pathways.",
        after:
          "Added rock edging and reset bed lines to create a clear separation between zones.",
        result:
          "Cleaner maintenance, better curb appeal, and a layout that holds up through the season.",
      },
    ],
    relatedServices: ["garden-bed-maintenance", "brush-clearing", "gravel-driveway-installation"],
    seasonalRelevance: ["spring", "summer", "fall"],
  },
  {
    id: "driveway-grading",
    slug: "driveway-grading",
    name: "Driveway Grading and Re-Leveling",
    shortName: "Driveway Grading",
    description: "Driveway grading and re-leveling for better drainage, fewer ruts, and smoother vehicle access.",
    longDescription: "Ruts, pooling water, and washboard surfaces can shorten driveway life and create ongoing maintenance headaches. Our driveway grading service reshapes and compacts gravel and aggregate surfaces for better drainage, smoother access, and a cleaner, more reliable finish. It is especially helpful after heavy rain, winter wear, or repeated vehicle tracking has pushed the surface out of shape.",
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
        {
          question: "When is grading enough and when do I probably need fresh gravel too?",
          answer: "If the driveway still has enough usable material and the main issue is shape, crown, or ruts, grading may be enough. If the surface is thin, patchy, or breaking down badly, fresh gravel or a larger refresh may be the better answer.",
        },
      ],
    beforeAfterScenarios: [
      {
        before:
          "Driveway had ruts, washboarding, and puddles at the entrance after rain.",
        after:
          "Surface was re-shaped with corrected crown, low spots filled, and grade tuned for runoff.",
        result:
          "Smoother access, less standing water, and fewer repeat touchups through the season.",
      },
      {
        before:
          "Aggregate had drifted to edges and centerline was uneven from repeated vehicle tracks.",
        after:
          "Material was redistributed and compacted with a more consistent profile across travel lanes.",
        result:
          "Cleaner look from the road and better day-to-day drivability for cars and work vehicles.",
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
    description: "Gravel driveway installation and refresh work with proper base prep, clean edges, and even aggregate placement.",
    longDescription: "Whether you're upgrading an older surface or adding a new gravel section, we provide practical driveway installation and refresh work tailored to your property. We focus on durable base preparation, clean edges, and even aggregate distribution for a strong, professional result that holds up better over time. The goal is a driveway that looks finished and stays more usable through changing weather.",
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
        {
          question: "Can you refresh part of a driveway instead of rebuilding the whole thing?",
          answer: "Often, yes. Some properties only need the entrance, turn area, parking section, or another high-wear area brought back up. We can look at the overall condition and recommend whether a partial refresh makes sense or whether a fuller pass will hold up better.",
        },
      ],
    beforeAfterScenarios: [
      {
        before:
          "Older gravel surface was thin, patchy, and soft in key turn and parking areas.",
        after:
          "New aggregate was placed over leveled base sections with edges defined and finished.",
        result:
          "Stronger surface hold, improved drainage behavior, and a visibly upgraded entrance.",
      },
      {
        before:
          "Driveway had mixed stone sizes and inconsistent depth from years of piecemeal top-ups.",
        after:
          "Surface was refreshed with coordinated material and final grading across the full run.",
        result:
          "More even compaction, cleaner finish, and less tracking of loose stone into adjacent areas.",
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
