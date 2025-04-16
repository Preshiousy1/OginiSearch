export interface Schema {
  name: string;
  version: number;
  fields: SchemaField[];
  created: Date;
  updated?: Date;
}

export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  required: boolean;
  searchable?: boolean;
  filterable?: boolean;
  facetable?: boolean;
  boost?: number;
  validators?: FieldValidator[];
}

export interface FieldValidator {
  type: string;
  params?: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export interface SchemaRegistry {
  registerSchema(schema: Schema): Promise<void>;
  getSchema(name: string): Promise<Schema | null>;
  listSchemas(): Promise<Schema[]>;
}
