import { business } from "../data/business";
import type { Location } from "../data/locations";
import type { Service } from "../data/services";
import type { FAQ } from "../data/faqs";

export const createLocalBusinessSchema = (location?: Location) => ({
  "@context": "https://schema.org",
  "@type": "LandscapingBusiness",
  "@id": `${business.siteUrl}/#business`,
  name: location ? `${business.name} - ${location.name}` : business.name,
  url: business.siteUrl,
  telephone: business.phoneTel,
  email: business.email,
  image: `${business.siteUrl}${business.socialImage}`,
  priceRange: business.priceRange,
  geo: {
    "@type": "GeoCoordinates",
    latitude: business.geo.latitude,
    longitude: business.geo.longitude,
  },
  address: {
    "@type": "PostalAddress",
    addressLocality: business.address.locality,
    addressRegion: business.address.region,
    addressCountry: business.address.country,
  },
  ...(location && {
    areaServed: {
      "@type": "City",
      name: location.name,
      containedInPlace: {
        "@type": "AdministrativeArea",
        name: "British Columbia",
      },
    },
  }),
});

export const createLocationPageSchema = (location: Location) => ({
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": `${business.siteUrl}/areas/${location.slug}/#business`,
  name: `${business.name} - ${location.name}`,
  url: `${business.siteUrl}/areas/${location.slug}`,
  telephone: business.phoneTel,
  email: business.email,
  priceRange: business.priceRange,
  areaServed: {
    "@type": "City",
    name: location.name,
    containedInPlace: {
      "@type": "AdministrativeArea",
      name: "British Columbia",
    },
  },
  geo: {
    "@type": "GeoCoordinates",
    latitude: business.geo.latitude,
    longitude: business.geo.longitude,
  },
  address: {
    "@type": "PostalAddress",
    addressLocality: business.address.locality,
    addressRegion: business.address.region,
    addressCountry: business.address.country,
  },
});

export const createServiceSchema = (service: Service) => ({
  "@context": "https://schema.org",
  "@type": "Service",
  "@id": `${business.siteUrl}/services/${service.slug}/#service`,
  name: service.name,
  serviceType: service.name,
  description: service.description,
  provider: {
    "@type": "LandscapingBusiness",
    "@id": `${business.siteUrl}/#business`,
    name: business.name,
  },
  areaServed: {
    "@type": "State",
    name: "British Columbia",
  },
});

export const createServiceLocationSchema = (service: Service, location: Location) => ({
  "@context": "https://schema.org",
  "@type": "Service",
  "@id": `${business.siteUrl}/services/${service.slug}/${location.slug}/#service`,
  name: `${service.shortName} in ${location.name}`,
  serviceType: service.name,
  description: `${service.description} Serving homeowners in ${location.name}, British Columbia.`,
  provider: {
    "@type": "LandscapingBusiness",
    "@id": `${business.siteUrl}/#business`,
    name: business.name,
    telephone: business.phoneTel,
  },
  areaServed: {
    "@type": "City",
    name: location.name,
    containedInPlace: {
      "@type": "AdministrativeArea",
      name: "British Columbia",
    },
  },
});

export const createFAQSchema = (faqs: FAQ[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
});

export const createBreadcrumbSchema = (
  items: Array<{ name: string; href: string }>
) => {
  const allItems = [{ name: "Home", href: "/" }, ...items];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: allItems.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.href.startsWith("http")
        ? item.href
        : `${business.siteUrl}${item.href}`,
    })),
  };
};

export const createArticleSchema = (post: {
  slug: string;
  data: {
    title: string;
    description: string;
    pubDate: Date;
    updatedDate?: Date;
    image?: string;
  };
}) => ({
  "@context": "https://schema.org",
  "@type": "Article",
  headline: post.data.title,
  description: post.data.description,
  image: post.data.image ? `${business.siteUrl}${post.data.image}` : undefined,
  datePublished: post.data.pubDate.toISOString(),
  dateModified: (post.data.updatedDate || post.data.pubDate).toISOString(),
  author: {
    "@type": "Organization",
    name: business.name,
  },
  publisher: {
    "@type": "Organization",
    name: business.name,
    logo: {
      "@type": "ImageObject",
      url: `${business.siteUrl}/logo.png`,
    },
  },
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${business.siteUrl}/blog/${post.slug}`,
  },
});

export const createOrganizationSchema = () => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: business.name,
  url: business.siteUrl,
  logo: `${business.siteUrl}/logo.png`,
  contactPoint: {
    "@type": "ContactPoint",
    telephone: business.phoneTel,
    contactType: "customer service",
  },
});

export const createWebsiteSchema = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: business.name,
  url: business.siteUrl,
});

export const createHomepageBusinessSchema = (
  areaServed: string[],
  serviceType: string[],
  description: string
) => ({
  ...createLocalBusinessSchema(),
  areaServed,
  serviceType,
  description,
});
