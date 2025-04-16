import { Schema, ValidationResult, SchemaField } from '../interfaces/schema.interface';

export class SchemaValidator {
  static validateDocument(schema: Schema, document: any): ValidationResult {
    const errors: string[] = [];

    // Check required fields
    for (const field of schema.fields) {
      if (field.required && (document[field.name] === undefined || document[field.name] === null)) {
        errors.push(`Required field '${field.name}' is missing`);
        continue;
      }

      // Skip validation if field is not present and not required
      if (document[field.name] === undefined || document[field.name] === null) {
        continue;
      }

      // Validate field type
      if (!this.validateFieldType(field, document[field.name])) {
        errors.push(`Field '${field.name}' has invalid type, expected ${field.type}`);
      }

      // Validate using field validators
      if (field.validators && field.validators.length > 0) {
        for (const validator of field.validators) {
          const validationResult = this.applyValidator(validator, field.name, document[field.name]);
          if (!validationResult.valid) {
            errors.push(...validationResult.errors);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private static validateFieldType(field: SchemaField, value: any): boolean {
    switch (field.type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'date':
        return value instanceof Date || !isNaN(Date.parse(value));
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return false;
    }
  }

  private static applyValidator(validator: any, fieldName: string, value: any): ValidationResult {
    const errors: string[] = [];

    switch (validator.type) {
      case 'min':
        if (
          (typeof value === 'number' && value < validator.params.value) ||
          (typeof value === 'string' && value.length < validator.params.value)
        ) {
          errors.push(`Field '${fieldName}' is below minimum value ${validator.params.value}`);
        }
        break;
      case 'max':
        if (
          (typeof value === 'number' && value > validator.params.value) ||
          (typeof value === 'string' && value.length > validator.params.value)
        ) {
          errors.push(`Field '${fieldName}' exceeds maximum value ${validator.params.value}`);
        }
        break;
      case 'pattern':
        if (typeof value === 'string' && !new RegExp(validator.params.pattern).test(value)) {
          errors.push(`Field '${fieldName}' does not match required pattern`);
        }
        break;
      case 'enum':
        if (!validator.params.values.includes(value)) {
          errors.push(`Field '${fieldName}' must be one of: ${validator.params.values.join(', ')}`);
        }
        break;
      // Add more validator types as needed
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
