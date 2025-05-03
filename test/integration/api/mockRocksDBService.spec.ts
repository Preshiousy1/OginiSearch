import { Test } from '@nestjs/testing';
import { RocksDBService } from '../../../src/storage/rocksdb/rocksdb.service';
import { TestDatabaseModule } from '../../utils/test-database.module';

describe('MockRocksDBService', () => {
  let rocks: RocksDBService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TestDatabaseModule],
    }).compile();
    rocks = module.get(RocksDBService);
  });

  it('should persist data', async () => {
    await rocks.put('foo', Buffer.from('bar'));
    const result = await rocks.get('foo');
    expect(result?.toString()).toBe('bar');
  });
});
