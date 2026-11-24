// Real job photos, November 2026. Verified from Josh's own photos.
// Honesty rules for this file:
// - Photos 21 (gutter-clean-standalone) show a DIFFERENT house from the
//   grey-house gutter job. They are never a "before / after" pair with the
//   clogged-gutter photos. Caption them only as what a cleared gutter looks
//   like, on their own.
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
    src: "/work/path-during-lifting.jpg",
    alt: "Josh lifting a paver into place, with the finished path behind",
    caption: "During: lifting a paver into place, with the finished path behind.",
    job: "path",
    width: 676,
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
    src: "/work/path-after-dog.jpg",
    alt: "Finished stepping-stone path with a dog standing on the pavers",
    caption: "After: the finished path from the house, dog approved.",
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
    src: "/work/path-after-wide.jpg",
    alt: "Finished stepping-stone path seen wide from the house",
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
    width: 676,
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
    src: "/work/roof-moss-bucket.jpg",
    alt: "Bucket of moss and pine needles pulled out of the roof and gutters",
    caption: "What we pulled out: a bucket of moss and needles from the roof and gutters.",
    job: "gutter",
    width: 676,
    height: 900,
  },
  {
    src: "/work/gutter-clean-standalone.jpg",
    alt: "A clean, cleared gutter on a different property",
    caption:
      "What a cleared gutter looks like. A different property, shown on its own — not the after for the job above.",
    job: "gutter",
    width: 900,
    height: 675,
  },
];

export const pathPhotos = workPhotos.filter((photo) => photo.job === "path");
export const gutterPhotos = workPhotos.filter((photo) => photo.job === "gutter");
