// Selected photos supplied for the November 2026 Maestros jobs.
// The path set follows one property through the work. Gutter photos describe
// visible conditions or collected debris; they do not claim a before/after pair.
// Red-house photos and footage with an unconfirmed sequence are not in this set.

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
    alt: "Bare garden track leading to the shed before the path was laid",
    caption: "Before: the garden track leading to the shed.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/path-during-dug.jpg",
    alt: "Excavated route beside the yellow house before the stones were laid",
    caption: "Preparation: digging out the route for the new path.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/path-during-compactor.jpg",
    alt: "Plate compactor on the prepared garden path beside a wheelbarrow",
    caption: "Preparation: compacting the route before laying the stones.",
    job: "path",
    width: 675,
    height: 900,
  },
  {
    src: "/work/path-during-kneeling.jpg",
    alt: "Josh placing and levelling a paving stone by hand",
    caption: "During: Josh placing and levelling the stones by hand.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/path-after-dog.jpg",
    alt: "Finished stepping-stone path curving towards the yellow house, with a dog on the path",
    caption: "After: the finished path across the garden.",
    job: "path",
    width: 900,
    height: 675,
  },
  {
    src: "/work/path-after-gate.jpg",
    alt: "Finished stepping-stone path through the garden gate beside the house",
    caption: "After: the path continuing through the gate.",
    job: "path",
    width: 675,
    height: 900,
  },
  {
    src: "/work/gutter-clogged-closeup.jpg",
    alt: "Leaves and needles collected in a gutter with standing water",
    caption: "Leaves, needles and standing water in the gutter.",
    job: "gutter",
    width: 675,
    height: 900,
  },
  {
    src: "/work/roof-valley-needles.jpg",
    alt: "Pine needles in a roof valley with moss on the surrounding shingles",
    caption: "Pine needles in the roof valley, with moss on the surrounding shingles.",
    job: "gutter",
    width: 900,
    height: 675,
  },
  {
    src: "/work/roof-moss-bucket.jpg",
    alt: "Moss and needles collected during a roof and gutter job",
    caption: "Moss and needles collected during the job.",
    job: "gutter",
    width: 675,
    height: 900,
  },
];

export const pathPhotos = workPhotos.filter((photo) => photo.job === "path");
export const gutterPhotos = workPhotos.filter((photo) => photo.job === "gutter");
