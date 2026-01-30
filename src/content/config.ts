import { defineCollection, z } from "astro:content";

const blogCollection = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    updatedDate: z.date().optional(),
    author: z.string().default("Maestros Services"),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    tags: z.array(z.string()),
    relatedServices: z.array(z.string()).optional(),
    relatedLocations: z.array(z.string()).optional(),
  }),
});

export const collections = {
  blog: blogCollection,
};
