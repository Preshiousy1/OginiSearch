# Document Indexing Guide

This guide covers best practices and techniques for indexing documents in Ogini.

## Basic Document Indexing

### Single Document Indexing

```typescript
const document = {
  title: 'Smartphone X',
  description: 'Latest smartphone with advanced features',
  price: 999.99,
  tags: ['electronics', 'mobile']
};

const result = await client.documents.indexDocument('products', {
  document
});
```

### Bulk Document Indexing

```typescript
const documents = [
  {
    title: 'Smartphone X',
    description: 'Latest smartphone with advanced features',
    price: 999.99,
    tags: ['electronics', 'mobile']
  },
  {
    title: 'Laptop Y',
    description: 'High-performance laptop for professionals',
    price: 1499.99,
    tags: ['electronics', 'computers']
  }
];

const result = await client.documents.bulkIndexDocuments(
  'products',
  documents.map(doc => ({ document: doc }))
);
```

## Document Structure

### Required Fields

Every document should have:
- A unique identifier (auto-generated if not provided)
- Fields that match the index mapping
- Valid data types for each field

### Example Document Structure

```typescript
interface ProductDocument {
  id?: string;              // Optional, auto-generated if not provided
  title: string;            // Text field for full-text search
  description: string;      // Text field for full-text search
  price: number;           // Numeric field for range queries
  tags: string[];          // Keyword field for exact matches
  metadata: {              // Object field for nested data
    brand: string;
    model: string;
    releaseDate: string;
  };
  createdAt: string;       // Date field for temporal queries
}
```

## Indexing Best Practices

### 1. Batch Processing

For large datasets, use bulk indexing with appropriate batch sizes:

```typescript
async function bulkIndexWithBatching(documents: any[], batchSize = 1000) {
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    await client.documents.bulkIndexDocuments(
      'products',
      batch.map(doc => ({ document: doc }))
    );
  }
}
```

### 2. Error Handling

Implement proper error handling for indexing operations:

```typescript
try {
  const result = await client.documents.indexDocument('products', {
    document
  });
} catch (error) {
  if (error.statusCode === 400) {
    // Handle validation errors
  } else if (error.statusCode === 404) {
    // Handle index not found
  } else {
    // Handle other errors
  }
}
```

### 3. Document Validation

Validate documents before indexing:

```typescript
function validateDocument(document: any, mapping: any) {
  // Check required fields
  for (const [field, config] of Object.entries(mapping.properties)) {
    if (config.required && !document[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Validate field types
  for (const [field, value] of Object.entries(document)) {
    const fieldConfig = mapping.properties[field];
    if (fieldConfig && !validateFieldType(value, fieldConfig.type)) {
      throw new Error(`Invalid type for field: ${field}`);
    }
  }
}
```

### 4. Optimizing Index Performance

1. **Use Appropriate Field Types**
   - Use `text` for full-text search
   - Use `keyword` for exact matches
   - Use `number` for numeric values
   - Use `date` for temporal data

2. **Configure Analyzers**
   ```typescript
   const indexConfig = {
     name: 'products',
     settings: {
       analysis: {
         analyzer: {
           custom_analyzer: {
             type: 'custom',
             tokenizer: 'standard',
             filter: ['lowercase', 'stop', 'snowball']
           }
         }
       }
     },
     mappings: {
       properties: {
         title: {
           type: 'text',
           analyzer: 'custom_analyzer'
         }
       }
     }
   };
   ```

3. **Use Bulk Operations**
   - Always use bulk operations for multiple documents
   - Implement retry logic for failed operations
   - Monitor indexing performance

4. **Handle Updates Efficiently**
   ```typescript
   async function updateDocument(index: string, id: string, updates: any) {
     // Get existing document
     const existing = await client.documents.getDocument(index, id);
     
     // Merge updates
     const updated = { ...existing, ...updates };
     
     // Reindex
     await client.documents.indexDocument(index, {
       id,
       document: updated
     });
   }
   ```

## Monitoring and Maintenance

1. **Monitor Index Size**
   ```typescript
   const stats = await client.indices.getStats('products');
   console.log(`Index size: ${stats.size}`);
   ```

2. **Check Index Health**
   ```typescript
   const health = await client.indices.getHealth('products');
   console.log(`Index health: ${health.status}`);
   ```

3. **Regular Maintenance**
   - Monitor indexing performance
   - Check for failed operations
   - Optimize index settings
   - Clean up old documents 