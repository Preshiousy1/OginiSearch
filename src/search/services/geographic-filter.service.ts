import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface LocationFilter {
  latitude?: number;
  longitude?: number;
  radius?: number; // in meters
  city?: string;
  area?: string;
  locationType: 'coordinates' | 'city' | 'area' | 'none';
}

export interface GeographicResult {
  id: string;
  distance?: number; // in meters
  locationScore: number; // 0-1 score based on location relevance
  isInRadius: boolean;
  locationData?: {
    latitude: number;
    longitude: number;
    city: string;
    area: string;
  };
}

@Injectable()
export class GeographicFilterService {
  private readonly logger = new Logger(GeographicFilterService.name);
  private readonly defaultRadius = 5000; // 5km default

  // Nigerian cities with approximate coordinates
  private readonly cityCoordinates = new Map<string, { lat: number; lng: number }>([
    ['lagos', { lat: 6.5244, lng: 3.3792 }],
    ['abuja', { lat: 9.082, lng: 7.3986 }],
    ['kano', { lat: 11.9914, lng: 8.5317 }],
    ['ibadan', { lat: 7.3961, lng: 3.8969 }],
    ['port harcourt', { lat: 4.8156, lng: 7.0498 }],
    ['benin city', { lat: 6.3176, lng: 5.6145 }],
    ['kaduna', { lat: 10.5222, lng: 7.4384 }],
    ['maiduguri', { lat: 11.8333, lng: 13.15 }],
    ['zaria', { lat: 11.1111, lng: 7.7222 }],
    ['jos', { lat: 9.8965, lng: 8.8583 }],
    ['ilorin', { lat: 8.5, lng: 4.55 }],
    ['oyo', { lat: 7.85, lng: 3.9333 }],
    ['enugu', { lat: 6.4584, lng: 7.5464 }],
    ['calabar', { lat: 4.9757, lng: 8.3417 }],
    ['katsina', { lat: 12.9908, lng: 7.6018 }],
    ['akure', { lat: 7.25, lng: 5.2 }],
    ['sokoto', { lat: 13.0627, lng: 5.2433 }],
    ['minna', { lat: 9.6139, lng: 6.5569 }],
    ['bauchi', { lat: 10.3158, lng: 9.8442 }],
    ['yola', { lat: 9.2035, lng: 12.4954 }],
    ['jalingo', { lat: 8.9, lng: 11.3667 }],
    ['damaturu', { lat: 11.7489, lng: 11.9661 }],
    ['gombe', { lat: 10.2897, lng: 11.1673 }],
    ['birnin kebbi', { lat: 12.4539, lng: 4.1975 }],
    ['dutse', { lat: 11.8283, lng: 9.315 }],
    ['gusau', { lat: 12.17, lng: 6.6644 }],
    ['lafia', { lat: 8.5, lng: 8.5167 }],
    ['markurdi', { lat: 7.7333, lng: 8.5333 }],
  ]);

  // Lagos areas with approximate coordinates
  private readonly lagosAreaCoordinates = new Map<string, { lat: number; lng: number }>([
    ['victoria island', { lat: 6.4281, lng: 3.4219 }],
    ['lekki', { lat: 6.4654, lng: 3.5658 }],
    ['ajah', { lat: 6.4654, lng: 3.5658 }],
    ['ikoyi', { lat: 6.4528, lng: 3.4333 }],
    ['surulere', { lat: 6.5, lng: 3.35 }],
    ['yaba', { lat: 6.5083, lng: 3.3833 }],
    ['ikeja', { lat: 6.6018, lng: 3.3515 }],
    ['oshodi', { lat: 6.55, lng: 3.3333 }],
    ['alimosho', { lat: 6.6, lng: 3.25 }],
    ['agege', { lat: 6.6167, lng: 3.3333 }],
    ['ifako-ijaiye', { lat: 6.65, lng: 3.3 }],
    ['kosofe', { lat: 6.55, lng: 3.4 }],
    ['mushin', { lat: 6.5333, lng: 3.35 }],
    ['oshodi-isolo', { lat: 6.55, lng: 3.3333 }],
    ['somolu', { lat: 6.5333, lng: 3.3667 }],
    ['mainland', { lat: 6.5, lng: 3.4 }],
    ['island', { lat: 6.45, lng: 3.4 }],
    ['lagos island', { lat: 6.45, lng: 3.4 }],
    ['lagos mainland', { lat: 6.5, lng: 3.4 }],
    ['apapa', { lat: 6.45, lng: 3.3667 }],
    ['amowo-odofin', { lat: 6.55, lng: 3.3 }],
    ['badagry', { lat: 6.4167, lng: 2.8833 }],
    ['epe', { lat: 6.5833, lng: 3.9833 }],
    ['ibeju-lekki', { lat: 6.4654, lng: 3.5658 }],
    ['ikorodu', { lat: 6.6167, lng: 3.5167 }],
    ['shomolu', { lat: 6.5333, lng: 3.3667 }],
  ]);

  constructor(private readonly configService?: ConfigService) {}

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Get coordinates for a location
   */
  getLocationCoordinates(location: string): { lat: number; lng: number } | null {
    const normalizedLocation = location.toLowerCase().trim();

    // Check Lagos areas first
    if (this.lagosAreaCoordinates.has(normalizedLocation)) {
      return this.lagosAreaCoordinates.get(normalizedLocation)!;
    }

    // Check Nigerian cities
    if (this.cityCoordinates.has(normalizedLocation)) {
      return this.cityCoordinates.get(normalizedLocation)!;
    }

    return null;
  }

  /**
   * Filter results based on geographic criteria
   */
  filterByLocation(
    results: any[],
    locationFilter: LocationFilter,
    userLocation?: { lat: number; lng: number },
  ): GeographicResult[] {
    const filteredResults: GeographicResult[] = [];

    for (const result of results) {
      let locationScore = 0;
      let distance: number | undefined;
      let isInRadius = true;

      // Extract location data from result
      const locationData = this.extractLocationData(result);

      if (
        locationFilter.locationType === 'coordinates' &&
        locationFilter.latitude &&
        locationFilter.longitude
      ) {
        // Filter by coordinates and radius
        if (locationData) {
          distance = this.calculateDistance(
            locationFilter.latitude,
            locationFilter.longitude,
            locationData.latitude,
            locationData.longitude,
          );

          const radius = locationFilter.radius || this.defaultRadius;
          isInRadius = distance <= radius;

          // Calculate location score based on distance
          locationScore = Math.max(0, 1 - distance / radius);
        }
      } else if (locationFilter.locationType === 'city' && locationFilter.city) {
        // Filter by city
        const cityCoords = this.getLocationCoordinates(locationFilter.city);
        if (cityCoords && locationData) {
          distance = this.calculateDistance(
            cityCoords.lat,
            cityCoords.lng,
            locationData.latitude,
            locationData.longitude,
          );

          const radius = locationFilter.radius || this.defaultRadius;
          isInRadius = distance <= radius;
          locationScore = Math.max(0, 1 - distance / radius);
        } else if (locationData?.city?.toLowerCase() === locationFilter.city.toLowerCase()) {
          // Exact city match
          locationScore = 1;
          isInRadius = true;
        }
      } else if (locationFilter.locationType === 'area' && locationFilter.area) {
        // Filter by area
        const areaCoords = this.getLocationCoordinates(locationFilter.area);
        if (areaCoords && locationData) {
          distance = this.calculateDistance(
            areaCoords.lat,
            areaCoords.lng,
            locationData.latitude,
            locationData.longitude,
          );

          const radius = locationFilter.radius || this.defaultRadius;
          isInRadius = distance <= radius;
          locationScore = Math.max(0, 1 - distance / radius);
        } else if (locationData?.area?.toLowerCase() === locationFilter.area.toLowerCase()) {
          // Exact area match
          locationScore = 1;
          isInRadius = true;
        }
      } else if (locationFilter.locationType === 'none') {
        // No location filtering
        locationScore = 0.5; // Neutral score
        isInRadius = true;
      }

      // User location proximity bonus
      if (userLocation && locationData) {
        const userDistance = this.calculateDistance(
          userLocation.lat,
          userLocation.lng,
          locationData.latitude,
          locationData.longitude,
        );

        // Boost score for nearby locations
        const proximityBonus = Math.max(0, 0.3 * (1 - userDistance / 10000)); // 10km range
        locationScore = Math.min(1, locationScore + proximityBonus);
      }

      filteredResults.push({
        id: result.id,
        distance,
        locationScore,
        isInRadius,
        locationData,
      });
    }

    return filteredResults;
  }

  /**
   * Extract location data from search result
   */
  private extractLocationData(result: any): {
    latitude: number;
    longitude: number;
    city: string;
    area: string;
  } | null {
    try {
      const source = result.source || result.document || {};

      // Try to extract coordinates
      let latitude: number | undefined;
      let longitude: number | undefined;

      if (source.latitude && source.longitude) {
        latitude = parseFloat(source.latitude);
        longitude = parseFloat(source.longitude);
      } else if (source.location && Array.isArray(source.location)) {
        // Handle array format [lng, lat]
        if (source.location.length >= 2) {
          longitude = parseFloat(source.location[0]);
          latitude = parseFloat(source.location[1]);
        }
      } else if (source.coordinates) {
        // Handle coordinates object
        if (source.coordinates.lat && source.coordinates.lng) {
          latitude = parseFloat(source.coordinates.lat);
          longitude = parseFloat(source.coordinates.lng);
        }
      }

      if (!latitude || !longitude) {
        return null;
      }

      return {
        latitude,
        longitude,
        city: source.city || source.city_name || '',
        area: source.area || source.area_name || source.suburb || '',
      };
    } catch (error) {
      this.logger.warn(`Failed to extract location data: ${error.message}`);
      return null;
    }
  }

  /**
   * Sort results by location relevance
   */
  sortByLocationRelevance(results: GeographicResult[], originalResults: any[]): any[] {
    // Create a map of original results by ID
    const resultMap = new Map(originalResults.map(r => [r.id, r]));

    // Sort by location score (descending)
    const sortedLocationResults = results
      .filter(r => r.isInRadius)
      .sort((a, b) => b.locationScore - a.locationScore);

    // Return original results in sorted order
    return sortedLocationResults
      .map(locationResult => resultMap.get(locationResult.id))
      .filter(Boolean);
  }

  /**
   * Get location filter from query
   */
  parseLocationFilter(query: string, userLocation?: { lat: number; lng: number }): LocationFilter {
    const normalizedQuery = query.toLowerCase();

    // Check for "near me" or user location
    if (normalizedQuery.includes('near me') || normalizedQuery.includes('close to me')) {
      if (userLocation) {
        return {
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          radius: 5000, // 5km
          locationType: 'coordinates',
        };
      }
    }

    // Check for city references
    for (const [city] of this.cityCoordinates) {
      if (normalizedQuery.includes(`in ${city}`) || normalizedQuery.includes(`at ${city}`)) {
        const coords = this.getLocationCoordinates(city);
        if (coords) {
          return {
            city,
            radius: 10000, // 10km for cities
            locationType: 'city',
          };
        }
      }
    }

    // Check for Lagos area references
    for (const [area] of this.lagosAreaCoordinates) {
      if (normalizedQuery.includes(`in ${area}`) || normalizedQuery.includes(`at ${area}`)) {
        const coords = this.getLocationCoordinates(area);
        if (coords) {
          return {
            area,
            radius: 5000, // 5km for areas
            locationType: 'area',
          };
        }
      }
    }

    // Check for distance references
    const distanceMatch = normalizedQuery.match(/(\d+)\s*(km|kilometers?|miles?)/i);
    if (distanceMatch) {
      const distance = parseInt(distanceMatch[1], 10);
      const unit = distanceMatch[2].toLowerCase();
      const radiusInMeters = unit.includes('mile') ? distance * 1609.34 : distance * 1000;

      if (userLocation) {
        return {
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          radius: radiusInMeters,
          locationType: 'coordinates',
        };
      }
    }

    return {
      locationType: 'none',
    };
  }
}
