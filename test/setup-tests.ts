// Mock RocksDB dependencies
jest.mock('rocksdb', () => {
  return {};
});

jest.mock('levelup', () => {
  return {};
});

jest.mock('encoding-down', () => {
  return {};
});
