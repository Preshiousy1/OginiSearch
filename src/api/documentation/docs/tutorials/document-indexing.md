# Document Indexing Guide

This guide covers the revolutionary **Smart Auto-Detection** approach and traditional techniques for indexing documents in Ogini.

## 🧠 Smart Auto-Detection Approach (Recommended)

### ⚡ Zero Configuration Required

With Ogini's Smart Field Mapping Auto-Detection, you can start indexing immediately without any field mapping configuration:

```typescript
// 1. Create index (no mappings needed!)
const index = await client.indices.createIndex({
  name: 'products',
  settings: {}  // Empty settings - smart detection will configure everything!
});

// 2. Index documents (auto-detection triggers)
const result = await client.documents.bulkIndexDocuments('products', [
  {
    document: {
      title: 'Smartphone X',
      description: 'Latest smartphone with advanced features',
      price: 999.99,
      tags: ['electronics', 'mobile'],
      created_at: '2024-01-15T10:30:00Z',
      email: 'support@company.com',
      specifications: {
        battery: {
          life: 24,
          fast_charging: true
        },
        display: {
          size: 6.1,
          resolution: '2560x1140'
        }
      },
      is_featured: true
    }
  }
]);

// 3. Start searching immediately! Mappings auto-configured:
// ✅ title → text with keyword sub-field
// ✅ price → float (auto-detected from 999.99)
// ✅ created_at → date (ISO format detected)
// ✅ email → keyword (email pattern detected)
// ✅ specifications.battery.life → integer
// ✅ is_featured → boolean
```

### 🎯 Intelligent Type Detection

The system automatically detects optimal field types:

```typescript
const smartDocument = {
  // Text fields (long content)
  title: 'Gaming Laptop Pro',
  description: 'High-performance gaming laptop with RGB lighting and advanced cooling',
  
  // Keyword fields (short identifiers)
  sku: 'GLB-2024-001',
  category: 'Electronics',
  
  // Numeric fields
  price: 1299.99,        // → float (decimal detected)
  stock: 15,             // → integer (whole number)
  
  // Date fields
  created_at: '2024-01-15T10:30:00Z',  // → date (ISO format)
  release_date: '2024-02-01',          // → date (date only)
  
  // Email and URL detection
  contact_email: 'sales@company.com',  // → keyword (email pattern)
  support_url: 'https://support.company.com',  // → keyword (URL pattern)
  
  // Boolean fields
  is_featured: true,     // → boolean
  in_stock: false,       // → boolean
  
  // Complex nested structures
  specifications: {      // → object
    processor: {         // → nested object
      brand: 'Intel',    // → keyword
      cores: 8,          // → integer
      speed: 3.2         // → float
    },
    storage: [           // → nested array
      {
        type: 'SSD',     // → keyword
        capacity: 1000   // → integer
      }
    ]
  }
};

// All field types automatically detected and optimized!
```

## Traditional Manual Approach

### Index Creation with Manual Mappings

```typescript
const index = await client.indices.createIndex({
  name: 'products',
  mappings: {
    properties: {
      title: { type: 'text', analyzer: 'standard' },
      description: { type: 'text', analyzer: 'standard' },
      price: { type: 'number' },
      tags: { type: 'keyword' }
    }
  }
});
```

### Basic Document Indexing

#### Single Document Indexing

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

#### Bulk Document Indexing

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

### Smart Auto-Detection Compatible Structure

```typescript
interface SmartProductDocument {
  // Auto-detected as text fields
  name: string;
  description: string;
  
  // Auto-detected as keyword fields
  sku: string;
  category: string;
  brand: string;
  
  // Auto-detected as numeric fields
  price: number;
  weight: number;
  stock_quantity: number;
  
  // Auto-detected as date fields
  created_at: string;  // ISO format recommended
  updated_at: string;
  
  // Auto-detected as email/URL keywords
  contact_email: string;
  support_url: string;
  
  // Auto-detected as boolean fields
  is_featured: boolean;
  is_available: boolean;
  
  // Auto-detected as arrays
  tags: string[];
  categories: string[];
  
  // Auto-detected as nested objects
  specifications: {
    dimensions: {
      length: number;
      width: number;
      height: number;
    };
    features: string[];
  };
  
  // Auto-detected as nested arrays
  reviews: Array<{
    rating: number;
    comment: string;
    reviewer_email: string;
    date: string;
  }>;
}
```

### Traditional Manual Structure

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

### 1. Leverage Smart Auto-Detection

**✅ Recommended Approach:**
```typescript
// Use bulk uploads for better type detection
const documents = [
  // Multiple similar documents help with accurate type detection
  { document: { price: 299.99, name: 'Product A' } },
  { document: { price: 1299.00, name: 'Product B' } },
  { document: { price: 49.95, name: 'Product C' } }
];

await client.documents.bulkIndexDocuments('products', documents);
```

**📝 Best Practices for Smart Detection:**
- Use consistent field names across documents
- Include representative data in first upload
- Use bulk uploads when possible for better sampling
- Ensure email fields contain valid email addresses
- Use ISO date formats for reliable date detection

### 2. Batch Processing

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

### 3. Error Handling

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

### 4. Manual Override When Needed

If you need to customize auto-detected mappings:

```typescript
// Check what was auto-detected
const index = await client.indices.getIndex('products');
console.log(index.mappings);

// Override specific fields if needed
await client.indices.updateMappings('products', {
  properties: {
    custom_field: {
      type: 'keyword',
      ignore_above: 128  // Custom limit
    }
  }
});

// Or trigger re-analysis after adding more documents
await client.indices.autoDetectMappings('products');
```

## 🚀 Smart vs Traditional Comparison

| Feature | Smart Auto-Detection | Traditional Manual |
|---------|---------------------|-------------------|
| **Setup Time** | ⚡ Instant | 🐌 Hours/Days |
| **Configuration** | 🧠 Automatic | ✍️ Manual coding |
| **Type Accuracy** | 🎯 AI-powered | 🤔 Human guesswork |
| **Maintenance** | 🔧 Self-updating | 🛠️ Manual updates |
| **Error Rate** | 📉 Minimal | 📈 Human errors |
| **Reindexing** | ❌ Never needed | ✅ Often required |

## Monitoring and Maintenance

1. **Check Auto-Detected Mappings**
   ```typescript
   const index = await client.indices.getIndex('products');
   console.log('Auto-detected mappings:', index.mappings);
   ```

2. **Monitor Index Performance**
   ```typescript
   const stats = await client.indices.getStats('products');
   console.log(`Documents: ${stats.documentCount}`);
   ```

3. **Re-analyze When Needed**
   ```typescript
   // Trigger re-analysis with more documents
   await client.indices.autoDetectMappings('products');
   ```

Ready to experience effortless document indexing? Start with smart auto-detection and let Ogini handle the complexity for you! 🎉 