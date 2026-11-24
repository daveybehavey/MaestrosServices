// Real job photos, November 2026. Verified from Josh's own photos.
// Honesty rules for this file:
// - Photos 21 and 22 (gutter-clean-standalone, gutter-clean-long) show a
//   DIFFERENT house from the grey-house gutter job. They are never a
//   "before / after" pair with the clogged-gutter photos. Caption them only
//   as what a cleared gutter looks like, on their own.
// - Gutter and roof photos are all "before" shots: what we found on the job.
//   We do not have a matched clean-after photo for that house yet.
// - No locations, prices, timeframes, or moss methods are claimed here.

export interface WorkPhoto {
  src: string;
  alt: string;
  caption: string;
  job: "path" | "gutter";
  width: number;
  height: number;
}

export const workPhotos: WorkPhoto[] = [
  {
    src: "/work/path-before-01.jpg",
    alt: "Bare dirt track with pallets of pavers by the shed, before we started",
    caption: "Before: a bare dirt track, with pallets of pavers waiting by the shed.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/path-after-gate.jpg",
    alt: "Finished stepping-stone path through the gate to the house",
    caption: "After: the finished path through the gate to the house.",
    job: "path",
    width: 675,
    height: 900,
  },
  {
    src: "/work/path-after-dog.jpg",
    alt: "Finished stepping-stone path with a dog standing on the pavers",
    caption: "After: the finished path from the house, dog approved.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/path-after-josh-pointing.jpg",
    alt: "Josh standing and pointing along the finished path to the moss shed",
    caption: "After: Josh pointing out the finished path to the moss shed.",
    job: "path",
    width: 675,
    height: 900,
  },
  {
    src: "/work/path-after-closeup.jpg",
    alt: "Close-up of the finished pavers with the moss shed and red shed behind",
    caption: "After, close-up: the pavers, with the moss shed and red shed behind.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/path-during-dug.jpg",
    alt: "Dug-out bare path with a yellow wheelbarrow and the house behind, no pavers yet",
    caption: "Before / during: the path dug out, wheelbarrow ready, no pavers yet.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/path-after-shed-side.jpg",
    alt: "Finished stepping-stone path, wide view from the shed side",
    caption: "After: the finished path, wide view from the shed side.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/path-after-gate-angle.jpg",
    alt: "Finished stepping-stone path through the gate, a second angle",
    caption: "After: the finished path through the gate, a second angle.",
    job: "path",
    width: 675,
    height: 900,
  },
  {
    src: "/work/path-during-lifting.jpg",
    alt: "Josh lifting a paver into place, with the finished path behind",
    caption: "During: lifting a paver into place, with the finished path behind.",
    job: "path",
    width: 675,
    height: 900,
  },
  {
    src: "/work/path-during-kneeling.jpg",
    alt: "Josh kneeling to place a paver on the new stone path",
    caption: "During: kneeling to place a paver, levelled as we went.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/path-during-kneeling-closeup.jpg",
    alt: "Josh kneeling close-up placing a paver",
    caption: "During: kneeling to place a paver, close-up.",
    job: "path",
    width: 675,
    height: 900,
  },
  {
    src: "/work/path-during-lifting-wide.jpg",
    alt: "Josh lifting a paver, wide angle, with the finished path and pallet stack behind",
    caption: "During: lifting a paver, wide angle, with the finished path and pallet stack behind.",
    job: "path",
    width: 675,
    height: 900,
  },
  {
    src: "/work/path-during-adjusting.jpg",
    alt: "Josh kneeling to adjust a paver into place",
    caption: "During: kneeling to adjust a paver into place.",
    job: "path",
    width: 675,
    height: 900,
  },
  {
    src: "/work/path-during-kneeling-red-shed.jpg",
    alt: "Josh kneeling to place a paver with the red shed behind",
    caption: "During: kneeling to place a paver, red shed behind.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/path-during-compactor.jpg",
    alt: "Blue compactor on the dug path with a wheelbarrow full of soil",
    caption: "During: the blue compactor on the dug path, wheelbarrow full of soil.",
    job: "path",
    width: 675,
    height: 900,
  },
  {
    src: "/work/path-after-wide.jpg",
    alt: "Finished stepping-stone path, wide view from the house",
    caption: "After: the finished path, wide view from the house.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/gutter-clogged-closeup.jpg",
    alt: "Clogged gutter close-up with black sludge and standing water",
    caption: "What we found: a clogged gutter, black sludge and standing water.",
    job: "gutter",
    width: 675,
    height: 900,
  },
  {
    src: "/work/roof-valley-needles.jpg",
    alt: "Roof valley full of pine needles and moss",
    caption: "What we found: a roof valley full of pine needles and moss.",
    job: "gutter",
    width: 900,
    height: 675,
  },
  {
    src: "/work/roof-moss-peak.jpg",
    alt: "Mossy roof peak",
    caption: "What we found: a mossy roof peak.",
    job: "gutter",
    width: 900,
    height: 675,
  },
  {
    src: "/work/roof-moss-bucket.jpg",
    alt: "Bucket of moss and pine needles pulled out of the roof and gutters",
    caption: "What we pulled out: a bucket of moss and needles from the roof and gutters.",
    job: "gutter",
    width: 675,
    height: 900,
  },
  {
    src: "/work/gutter-clean-standalone.jpg",
    alt: "A clean, cleared gutter on a different property",
    caption: "What a cleared gutter looks like. A different property, shown on its own — not the after for the job above.",
    job: "gutter",
    width: 900,
    height: 675,
  },
  {
    src: "/work/gutter-clean-long.jpg",
    alt: "A clean, cleared gutter, long view, on a different property",
    caption: "What a cleared gutter looks like, long view. A different property, shown on its own — not the after for the job above.",
    job: "gutter",
    width: 675,
    height: 900,
  },
  {
    src: "/work/gutter-long-deck.jpg",
    alt: "Long gutter run above the deck with a mossy roof behind it",
    caption: "What we found: a long gutter run above the deck, with the roof mossy behind it.",
    job: "gutter",
    width: 675,
    height: 900,
  },
  {
    src: "/work/roof-moss-gutter-yard.jpg",
    alt: "Mossy roof and gutter with the yard below",
    caption: "What we found: a mossy roof and gutter, with the yard below.",
    job: "gutter",
    width: 900,
    height: 675,
  },
  {
    src: "/work/gutter-dirty-fascia.jpg",
    alt: "Dirty gutter close-up with fascia and bare branches",
    caption: "What we found: a dirty gutter close-up, fascia and bare branches.",
    job: "gutter",
    width: 675,
    height: 900,
  },
  {
    src: "/work/gutter-long-van.jpg",
    alt: "Long gutter run under the deck with a van below",
    caption: "What we found: a long gutter run under the deck, van below.",
    job: "gutter",
    width: 675,
    height: 900,
  },
  {
    src: "/work/gutter-long-car.jpg",
    alt: "Long gutter run under the deck with a white car below",
    caption: "What we found: a long gutter run under the deck, white car below.",
    job: "gutter",
    width: 675,
    height: 900,
  },
  {
    src: "/work/gutter-dirty-stains.jpg",
    alt: "Dirty gutter close-up with fascia water stains",
    caption: "What we found: a dirty gutter close-up, fascia with water stains.",
    job: "gutter",
    width: 675,
    height: 900,
  },
];

export const pathPhotos = workPhotos.filter((photo) => photo.job === "path");
export const gutterPhotos = workPhotos.filter((photo) => photo.job === "gutter");
