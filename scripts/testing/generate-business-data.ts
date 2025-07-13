import { faker } from '@faker-js/faker';
import * as fs from 'fs';
import * as path from 'path';

// Nigerian business categories and subcategories
const BUSINESS_CATEGORIES = {
  'Information Technology': [
    'Website Development',
    'Application Development',
    'Software Development',
    'Cloud Computing',
    'Product Design',
    'Geographic Information System (GIS)',
    'Internet Service Provider',
  ],
  Healthcare: ['Hospital', 'Pharmacy', 'Medical Laboratory', 'Clinic', 'Dental Care'],
  Store: ['Online Store', 'Retail Store', 'Supermarket', 'Electronics Store', 'Fashion Store'],
  'Chemical Dealer': [
    'Plastic Dealers',
    'Industrial Chemicals',
    'Paint Chemicals',
    'Agricultural Chemicals',
  ],
  'Packaging Company': ['Packaging Company', 'Carton Manufacturing', 'Plastic Packaging'],
  'Advertising Agencies': [
    'Digital Marketing',
    'Brand Management',
    'Media Planning',
    'Content Creation',
  ],
};

// Helper function to generate a business ID number
function generateBusinessIdNumber(): string {
  return `CNB${faker.string.alphanumeric(9)}`;
}

// Helper function to generate a realistic business profile
function generateBusinessProfile(category: string): string {
  const mission = faker.company.catchPhrase();
  const vision = faker.company.buzzPhrase();
  const description = faker.company.catchPhrase();

  return `<p>${description}</p>
<p><strong>Mission:</strong> ${mission}</p>
<p><strong>Vision:</strong> ${vision}</p>`;
}

// Helper function to get random items from an array
function getRandomItems<T>(array: T[], min = 1, max = 3): T[] {
  const count = faker.number.int({ min, max });
  return faker.helpers.arrayElements(array, count);
}

// Helper function for probability-based values
function withProbability<T>(value: T, probability = 0.5): T | null {
  return faker.number.int({ min: 0, max: 100 }) < probability * 100 ? value : null;
}

// Generate a single business document
function generateBusinessDocument(id: number): any {
  const category = faker.helpers.objectValue(BUSINESS_CATEGORIES);
  const categoryName =
    Object.keys(BUSINESS_CATEGORIES).find(key => BUSINESS_CATEGORIES[key] === category) ||
    'Information Technology';

  const name = faker.company.name();
  const createdAt = faker.date.future({ years: 2 }).toISOString();
  const updatedAt = faker.date
    .between({
      from: createdAt,
      to: new Date(new Date(createdAt).getTime() + 30 * 24 * 60 * 60 * 1000),
    })
    .toISOString();

  return {
    id: id.toString(),
    index: 'businesses',
    version: 1,
    found: true,
    source: {
      id: id,
      id_number: generateBusinessIdNumber(),
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id}`,
      health: faker.number.int({ min: 40, max: 100 }),
      average_rating: faker.number.float({ min: 0, max: 5, fractionDigits: 2 }).toFixed(2),
      profile: generateBusinessProfile(categoryName),
      verified_at: withProbability(faker.date.future().toISOString(), 0.7),
      is_featured: withProbability(true, 0.1),
      is_verified: withProbability(true, 0.8),
      is_active: withProbability(true, 0.9),
      is_blocked: withProbability(true, 0.05),
      is_confirmed: withProbability(true, 0.7),
      has_changed_logo: withProbability(true, 0.6),
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: withProbability(faker.date.future().toISOString(), 0.05),
      has_contacts: true,
      category_name: categoryName,
      sub_category_name: getRandomItems(BUSINESS_CATEGORIES[categoryName]),
      contact_emails: [
        faker.internet.email({ provider: 'gmail.com' }),
        ...(withProbability([faker.internet.email()], 0.3) || []),
      ],
      tags:
        withProbability(
          faker.helpers.arrayElements(['Premium', 'Featured', 'New', 'Trending'], 2).join(','),
          0.4,
        ) || '',
      locations: [],
    },
  };
}

// Export function to generate multiple business documents
export function generateBusinessDocuments(count: number, startId = 1): any[] {
  console.log(`Generating ${count.toLocaleString()} business documents...`);
  const startTime = Date.now();

  const documents = Array.from({ length: count }, (_, i) => generateBusinessDocument(startId + i));

  const endTime = Date.now();
  console.log(
    `Generated ${count.toLocaleString()} documents in ${((endTime - startTime) / 1000).toFixed(
      2,
    )}s`,
  );

  return documents;
}

// If this file is run directly, generate and save test data
if (require.main === module) {
  const NUM_DOCUMENTS = 1200000; // 1.2M documents
  const OUTPUT_FILE = path.join(__dirname, '../../data/bulk-business-data.json');

  console.log(`Generating ${NUM_DOCUMENTS.toLocaleString()} test business documents...`);
  const documents = generateBusinessDocuments(NUM_DOCUMENTS);

  // Ensure data directory exists
  const dataDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Write to file in chunks to manage memory
  const stream = fs.createWriteStream(OUTPUT_FILE);
  stream.write('{"documents":[\n');

  for (let i = 0; i < documents.length; i++) {
    const isLast = i === documents.length - 1;
    stream.write(JSON.stringify(documents[i]) + (isLast ? '\n' : ',\n'));

    // Log progress every 100k documents
    if ((i + 1) % 100000 === 0) {
      console.log(`Written ${(i + 1).toLocaleString()} documents...`);
    }
  }

  stream.write(']}');
  stream.end();

  console.log(`Test data written to ${OUTPUT_FILE}`);
}
