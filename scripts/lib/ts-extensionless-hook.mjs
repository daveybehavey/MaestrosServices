// Test-only resolve hook: Node's native TypeScript loader resolves
// extensioned .ts imports (as quote-handler.test.mjs already does for
// functions/api/quote.ts) but not the extensionless "../data/business"
// style used by Astro source under src/. This hook appends .ts for
// relative extensionless specifiers so schema.ts / sitemapLastmod.ts
// can be exercised by node --test without changing production imports.
import { register } from "node:module";

register("./ts-extensionless-loader.mjs", import.meta.url);
