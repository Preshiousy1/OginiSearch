export interface QueryComponents {
  original: string;
  normalized: string;
  entities: QueryEntities;
  intent: SearchIntent;
  expanded: string;
  locationContext?: LocationContext;
}

export interface QueryEntities {
  businessTypes: string[];
  locations: string[];
  services: string[];
  modifiers: string[];
}

export interface LocationContext {
  type: 'user_location' | 'named_location' | 'coordinates';
  radius?: number; // in meters
  coordinates?: { lat: number; lng: number };
  locationName?: string;
}

export type SearchIntent = 'informational' | 'transactional' | 'navigational';

export interface EntityExtractionResult {
  businessTypes: string[];
  locations: string[];
  services: string[];
  modifiers: string[];
}

export interface QueryExpansionResult {
  original: string;
  expanded: string;
  synonyms: string[];
  relatedTerms: string[];
}

export interface LocationProcessingResult {
  hasLocation: boolean;
  context?: LocationContext;
  radius?: number;
  coordinates?: { lat: number; lng: number };
}
