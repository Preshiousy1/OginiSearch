import { ConnectSearch } from '../index';

/**
 * Example of basic ConnectSearch client usage
 */
async function main() {
  // Initialize the client
  const client = new ConnectSearch({
    baseURL: 'http://localhost:3000',
  });

  try {
    // Create a new index
    const createIndexResponse = await client.indices.createIndex({
      name: 'products',
      settings: {
        numberOfShards: 1,
        refreshInterval: '1s',
      },
      mappings: {
        properties: {
          title: { type: 'text' },
          description: { type: 'text' },
          price: { type: 'float' },
          categories: { type: 'keyword' },
        },
      },
    });

    console.log('Index created:', createIndexResponse);

    // Index some documents
    const document1 = await client.documents.indexDocument('products', {
      title: 'Smartphone X',
      description: 'Latest smartphone with advanced features',
      price: 999.99,
      categories: ['electronics', 'mobile'],
    });

    console.log('Document 1 indexed:', document1);

    const document2 = await client.documents.indexDocument('products', {
      title: 'Laptop Pro',
      description: 'High-performance laptop for professionals',
      price: 1499.99,
      categories: ['electronics', 'computers'],
    });

    console.log('Document 2 indexed:', document2);

    // Bulk index documents
    const bulkResponse = await client.documents.bulkIndexDocuments('products', [
      {
        document: {
          title: 'Wireless Headphones',
          description: 'Noise-cancelling wireless headphones',
          price: 199.99,
          categories: ['electronics', 'audio'],
        },
      },
      {
        document: {
          title: 'Smart Watch',
          description: 'Fitness tracker and smartwatch',
          price: 249.99,
          categories: ['electronics', 'wearables'],
        },
      },
    ]);

    console.log('Bulk indexing response:', bulkResponse);

    // Search for documents
    const searchResponse = await client.search.search(
      'products',
      client.search.createMultiFieldQuery('smartphone', ['title', 'description']),
    );

    console.log('Search results:', searchResponse);

    // Get suggestions
    const suggestResponse = await client.search.suggest('products', {
      text: 'lapt',
      field: 'title',
      size: 5,
    });

    console.log('Suggestions:', suggestResponse);

    // Delete a document
    await client.documents.deleteDocument('products', document1.id);
    console.log('Document deleted');

    // Delete documents by query
    const deleteByQueryResponse = await client.documents.deleteByQuery('products', {
      query: {
        term: {
          field: 'categories',
          value: 'wearables',
        },
      },
    });

    console.log('Delete by query response:', deleteByQueryResponse);

    // List all indices
    const listIndicesResponse = await client.indices.listIndices();
    console.log('All indices:', listIndicesResponse);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run the example
main().catch(error => {
  console.error('Unhandled error:', error);
});
