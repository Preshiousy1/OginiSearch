import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LocationContext,
  LocationProcessingResult,
} from '../interfaces/intelligent-search.interface';

@Injectable()
export class LocationProcessorService {
  private readonly logger = new Logger(LocationProcessorService.name);

  // Default radius for location-based searches (in meters)
  private readonly defaultRadius = 5000; // 5km

  // Location patterns for parsing
  private readonly locationPatterns = {
    userLocation: /\b(near|close to|around)\s+me\b/i,
    namedLocation: /\b(in|at|within)\s+([a-zA-Z\s]+)\b/i,
    coordinates: /\b(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\b/,
    radius: /\bwithin\s+(\d+)\s*(km|miles?|meters?)\b/i,
    distance: /\b(\d+)\s*(km|miles?|meters?)\s+(from|of|away)\b/i,
  };

  // Common Nigerian cities and areas
  private readonly nigerianCities = [
    'lagos',
    'abuja',
    'kano',
    'ibadan',
    'port harcourt',
    'benin city',
    'kaduna',
    'maiduguri',
    'zaria',
    'abuja',
    'jos',
    'ilorin',
    'oyo',
    'enugu',
    'calabar',
    'katsina',
    'akure',
    'sokoto',
    'minna',
    'bauchi',
    'yola',
    'jalingo',
    'damaturu',
    'gombe',
    'birnin kebbi',
    'dutse',
    'gusau',
    'lafia',
    'markurdi',
    'jalingo',
    'yobe',
    'kebbi',
    'kogi',
    'kwara',
    'nasarawa',
    'niger',
    'plateau',
    'taraba',
    'zamfara',
    'abia',
    'adamawa',
    'akwa ibom',
    'anambra',
    'bayelsa',
    'cross river',
    'delta',
    'ebonyi',
    'edo',
    'ekiti',
    'imo',
    'jigawa',
    'kaduna',
    'katsina',
    'kebbi',
    'kogi',
    'kwara',
    'nasarawa',
    'niger',
    'ogun',
    'ondo',
    'osun',
    'oyo',
    'plateau',
    'rivers',
    'sokoto',
    'taraba',
    'yobe',
    'zamfara',
  ];

  // Lagos areas
  private readonly lagosAreas = [
    'victoria island',
    'lekki',
    'ajah',
    'ikoyi',
    'surulere',
    'yaba',
    'ikeja',
    'oshodi',
    'alimosho',
    'agege',
    'ifako-ijaiye',
    'kosofe',
    'mushin',
    'oshodi-isolo',
    'somolu',
    'mainland',
    'island',
    'lagos island',
    'lagos mainland',
    'apapa',
    'amowo-odofin',
    'badagry',
    'epe',
    'ibeju-lekki',
    'ikorodu',
    'oshodi',
    'shomolu',
    'surulere',
  ];

  constructor(private readonly configService?: ConfigService) {}

  /**
   * Process location references in a query
   */
  async processLocationQuery(
    query: string,
    userLocation?: { lat: number; lng: number },
  ): Promise<LocationProcessingResult> {
    const normalizedQuery = this.normalizeQuery(query);

    // Check for user location references
    if (this.hasUserLocationReference(normalizedQuery)) {
      if (userLocation) {
        return {
          hasLocation: true,
          context: {
            type: 'user_location',
            radius: this.extractRadius(normalizedQuery),
            coordinates: userLocation,
          },
          radius: this.extractRadius(normalizedQuery),
          coordinates: userLocation,
        };
      } else {
        // User location requested but not provided
        return {
          hasLocation: true,
          context: {
            type: 'user_location',
            radius: this.extractRadius(normalizedQuery),
          },
          radius: this.extractRadius(normalizedQuery),
        };
      }
    }

    // Check for named locations
    const namedLocation = this.extractNamedLocation(normalizedQuery);
    if (namedLocation) {
      return {
        hasLocation: true,
        context: {
          type: 'named_location',
          locationName: namedLocation,
          radius: this.extractRadius(normalizedQuery),
        },
        radius: this.extractRadius(normalizedQuery),
      };
    }

    // Check for coordinates
    const coordinates = this.extractCoordinates(normalizedQuery);
    if (coordinates) {
      return {
        hasLocation: true,
        context: {
          type: 'coordinates',
          coordinates,
          radius: this.extractRadius(normalizedQuery),
        },
        radius: this.extractRadius(normalizedQuery),
        coordinates,
      };
    }

    return { hasLocation: false };
  }

  /**
   * Check if query contains user location references
   */
  private hasUserLocationReference(query: string): boolean {
    return this.locationPatterns.userLocation.test(query);
  }

  /**
   * Extract named location from query
   */
  private extractNamedLocation(query: string): string | null {
    const match = query.match(this.locationPatterns.namedLocation);
    if (match && match[2]) {
      return match[2].trim();
    }
    return null;
  }

  /**
   * Extract coordinates from query
   */
  private extractCoordinates(query: string): { lat: number; lng: number } | null {
    const match = query.match(this.locationPatterns.coordinates);
    if (match && match[1] && match[2]) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);

      // Validate coordinates
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }
    return null;
  }

  /**
   * Extract radius from query
   */
  private extractRadius(query: string): number {
    const match = query.match(this.locationPatterns.radius);
    if (match && match[1]) {
      const value = parseInt(match[1], 10);
      const unit = match[2]?.toLowerCase();

      // Convert to meters
      switch (unit) {
        case 'km':
          return value * 1000;
        case 'miles':
        case 'mile':
          return value * 1609.34;
        case 'meters':
        case 'meter':
        case 'm':
          return value;
        default:
          return value; // Assume meters if no unit specified
      }
    }

    return this.defaultRadius;
  }

  /**
   * Normalize query for consistent processing
   */
  private normalizeQuery(query: string): string {
    if (!query) return '';
    return query.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Check if a location is within radius of a center point
   */
  isWithinRadius(
    centerLat: number,
    centerLng: number,
    targetLat: number,
    targetLng: number,
    radius: number,
  ): boolean {
    const distance = this.calculateDistance(centerLat, centerLng, targetLat, targetLng);
    return distance <= radius;
  }

  /**
   * Get default radius for location searches
   */
  getDefaultRadius(): number {
    return this.defaultRadius;
  }

  /**
   * Check if a location is a known Nigerian city
   */
  isNigerianCity(location: string): boolean {
    return this.nigerianCities.includes(location.toLowerCase());
  }

  /**
   * Check if a location is a known Lagos area
   */
  isLagosArea(location: string): boolean {
    return this.lagosAreas.includes(location.toLowerCase());
  }

  /**
   * Get location type based on the location name
   */
  getLocationType(location: string): 'nigerian_city' | 'lagos_area' | 'general_area' | 'unknown' {
    const normalizedLocation = location.toLowerCase();

    if (this.isLagosArea(normalizedLocation)) {
      return 'lagos_area';
    }

    if (this.isNigerianCity(normalizedLocation)) {
      return 'nigerian_city';
    }

    // Check for common area indicators
    if (
      normalizedLocation.includes('street') ||
      normalizedLocation.includes('road') ||
      normalizedLocation.includes('avenue') ||
      normalizedLocation.includes('close') ||
      normalizedLocation.includes('drive')
    ) {
      return 'general_area';
    }

    return 'unknown';
  }

  /**
   * Extract distance information from query
   */
  extractDistance(query: string): { distance: number; unit: string } | null {
    const distanceMatch = query.match(this.locationPatterns.distance);
    if (distanceMatch) {
      return {
        distance: parseInt(distanceMatch[1], 10),
        unit: distanceMatch[2],
      };
    }
    return null;
  }
}
