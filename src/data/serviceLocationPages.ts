import { getLocationById, locations, type Location } from "./locations";
import { getServiceById, services, type Service } from "./services";

export interface ServiceLocationPageEntry {
  serviceId: Service["id"];
  locationId: Location["id"];
}

export const prioritizedServiceIds: Service["id"][] = services.map((service) => service.id);

export const prioritizedLocationIds: Location["id"][] = locations.map((location) => location.id);

export const serviceLocationPageEntries: ServiceLocationPageEntry[] = prioritizedLocationIds.flatMap(
  (locationId) =>
    prioritizedServiceIds.map((serviceId) => ({
      serviceId,
      locationId,
    }))
);

export const serviceLocationPages = serviceLocationPageEntries.map((entry) => {
  const service = getServiceById(entry.serviceId);
  const location = getLocationById(entry.locationId);

  if (!service || !location) {
    throw new Error(`Missing service or location for "${entry.serviceId}:${entry.locationId}"`);
  }

  return {
    ...entry,
    service,
    location,
    href: `/services/${service.slug}/${location.slug}`,
  };
});

const serviceLocationPageKeySet = new Set(
  serviceLocationPageEntries.map((entry) => `${entry.serviceId}:${entry.locationId}`)
);

export const hasServiceLocationPage = (
  serviceId: Service["id"],
  locationId: Location["id"]
) => serviceLocationPageKeySet.has(`${serviceId}:${locationId}`);

export const getServiceLocationPagesForService = (serviceId: Service["id"]) =>
  serviceLocationPages.filter((entry) => entry.serviceId === serviceId);

export const getServiceLocationPagesForLocation = (locationId: Location["id"]) =>
  serviceLocationPages.filter((entry) => entry.locationId === locationId);
