export interface ProcessedDocument {
  id: string;
  fields: Record<string, string[]>;
  fieldLengths: Record<string, number>;
}
