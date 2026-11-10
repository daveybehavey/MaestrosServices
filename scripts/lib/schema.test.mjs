import assert from "node:assert/strict";
import test from "node:test";

import { business } from "../../src/data/business.ts";
import { locations } from "../../src/data/locations.ts";
import { services } from "../../src/data/services.ts";
import {
  createArticleSchema,
  createBreadcrumbSchema,
  createFAQSchema,
  createHomepageBusinessSchema,
  createLocalBusinessSchema,
  createLocationPageSchema,
  createOrganizationSchema,
  createServiceLocationSchema,
  createServiceSchema,
  createWebsiteSchema,
} from "../../src/lib/schema.ts";

// Pins the testable construction rules in src/lib/schema.ts. Each assertion
// is hand-computed from the source (IDs, types, breadcrumb positions, FAQ
// mapping). Catches regressions that would ship wrong JSON-LD without a
// visual failure.

test("createLocalBusinessSchema: default id, type, and geo/address come from business facts (regression: drifting @id or unpublished address fields)", () => {
  const schema = createLocalBusinessSchema();
  assert.equal(schema["@type"], "LandscapingBusiness");
  assert.equal(schema["@id"], `${business.siteUrl}/#business`);
  assert.equal(schema.name, business.name);
  assert.equal(schema.telephone, business.phoneTel);
  assert.equal(schema.email, business.email);
  assert.equal(schema.priceRange, business.priceRange);
  assert.deepEqual(schema.geo, {
    "@type": "GeoCoordinates",
    latitude: business.geo.latitude,
    longitude: business.geo.longitude,
  });
  assert.equal(schema.address.addressLocality, business.address.locality);
  assert.equal(schema.address.addressRegion, business.address.region);
  assert.equal(schema.address.addressCountry, business.address.country);
  // No street address key is published (owner constraint).
  assert.equal("streetAddress" in schema.address, false);
  assert.equal(Array.isArray(schema.areaServed), true);
  assert.equal(schema.areaServed.length, locations.length);
});

test("createLocalBusinessSchema: location argument scopes name and areaServed to that city (regression: location pages advertising every city)", () => {
  const location = locations[0];
  const schema = createLocalBusinessSchema(location);
  assert.equal(schema.name, `${business.name} - ${location.name}`);
  assert.deepEqual(schema.areaServed, {
    "@type": "City",
    name: location.name,
    containedInPlace: { "@type": "AdministrativeArea", name: "British Columbia" },
  });
});

test("createLocationPageSchema: @id and url use /areas/{slug} (regression: broken location canonicals in JSON-LD)", () => {
  const location = locations[0];
  const schema = createLocationPageSchema(location);
  assert.equal(schema["@type"], "LocalBusiness");
  assert.equal(schema["@id"], `${business.siteUrl}/areas/${location.slug}/#business`);
  assert.equal(schema.url, `${business.siteUrl}/areas/${location.slug}`);
  assert.equal(schema.name, `${business.name} - ${location.name}`);
});

test("createServiceSchema and createServiceLocationSchema: ids and names follow slug rules (regression: service/location mashup IDs)", () => {
  const service = services[0];
  const location = locations[0];
  const serviceSchema = createServiceSchema(service);
  assert.equal(serviceSchema["@type"], "Service");
  assert.equal(serviceSchema["@id"], `${business.siteUrl}/services/${service.slug}/#service`);
  assert.equal(serviceSchema.name, service.name);
  assert.equal(serviceSchema.provider["@id"], `${business.siteUrl}/#business`);

  const combo = createServiceLocationSchema(service, location);
  assert.equal(combo["@id"], `${business.siteUrl}/services/${service.slug}/${location.slug}/#service`);
  assert.equal(combo.name, `${service.shortName} in ${location.name}`);
  assert.equal(combo.areaServed.name, location.name);
});

test("createFAQSchema: each FAQ becomes a Question/Answer pair in order (regression: dropping or reordering FAQs)", () => {
  const faqs = [
    { question: "Q1?", answer: "A1." },
    { question: "Q2?", answer: "A2." },
  ];
  const schema = createFAQSchema(faqs);
  assert.equal(schema["@type"], "FAQPage");
  assert.equal(schema.mainEntity.length, 2);
  assert.deepEqual(schema.mainEntity[0], {
    "@type": "Question",
    name: "Q1?",
    acceptedAnswer: { "@type": "Answer", text: "A1." },
  });
  assert.deepEqual(schema.mainEntity[1], {
    "@type": "Question",
    name: "Q2?",
    acceptedAnswer: { "@type": "Answer", text: "A2." },
  });
});

test("createBreadcrumbSchema: Home is prepended and positions are 1-indexed (regression: off-by-one breadcrumb positions)", () => {
  const schema = createBreadcrumbSchema([
    { name: "Services", href: "/services" },
    { name: "Mowing", href: "/services/mowing" },
  ]);
  assert.equal(schema["@type"], "BreadcrumbList");
  assert.equal(schema.itemListElement.length, 3);
  assert.deepEqual(schema.itemListElement[0], {
    "@type": "ListItem",
    position: 1,
    name: "Home",
    item: `${business.siteUrl}/`,
  });
  assert.equal(schema.itemListElement[1].position, 2);
  assert.equal(schema.itemListElement[1].item, `${business.siteUrl}/services`);
  assert.equal(schema.itemListElement[2].position, 3);
  assert.equal(schema.itemListElement[2].item, `${business.siteUrl}/services/mowing`);
});

test("createBreadcrumbSchema: absolute hrefs are kept verbatim (regression: double-prefixing absolute URLs)", () => {
  const absolute = `${business.siteUrl}/quote`;
  const schema = createBreadcrumbSchema([{ name: "Quote", href: absolute }]);
  assert.equal(schema.itemListElement[1].item, absolute);
});

test("createArticleSchema: dateModified falls back to pubDate when updatedDate is absent (regression: missing dateModified)", () => {
  const pubDate = new Date("2024-06-01T12:00:00.000Z");
  const withoutUpdate = createArticleSchema({
    slug: "sample-post",
    data: { title: "Title", description: "Desc", pubDate },
  });
  assert.equal(withoutUpdate.datePublished, pubDate.toISOString());
  assert.equal(withoutUpdate.dateModified, pubDate.toISOString());
  assert.equal(withoutUpdate.mainEntityOfPage["@id"], `${business.siteUrl}/blog/sample-post`);

  const updatedDate = new Date("2024-07-01T12:00:00.000Z");
  const withUpdate = createArticleSchema({
    slug: "sample-post",
    data: { title: "Title", description: "Desc", pubDate, updatedDate },
  });
  assert.equal(withUpdate.dateModified, updatedDate.toISOString());
});

test("createOrganizationSchema / createWebsiteSchema / createHomepageBusinessSchema: stable top-level types (regression: homepage graph shape drift)", () => {
  const org = createOrganizationSchema();
  assert.equal(org["@type"], "Organization");
  assert.equal(org.url, business.siteUrl);
  assert.equal(org.contactPoint.telephone, business.phoneTel);

  const site = createWebsiteSchema();
  assert.equal(site["@type"], "WebSite");
  assert.equal(site.name, business.name);

  const homepage = createHomepageBusinessSchema(["Duncan"], ["Pressure washing"], "Homepage description");
  assert.equal(homepage["@type"], "LandscapingBusiness");
  assert.deepEqual(homepage.serviceType, ["Pressure washing"]);
  assert.equal(homepage.description, "Homepage description");
});
