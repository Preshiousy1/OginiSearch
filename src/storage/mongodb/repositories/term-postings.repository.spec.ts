import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { TermPostingsRepository } from './term-postings.repository';
import { TermPostings, PostingEntry } from '../schemas/term-postings.schema';
import { MAX_POSTINGS_PER_CHUNK } from '../schemas/term-postings.schema';

describe('TermPostingsRepository (chunked)', () => {
  let repo: TermPostingsRepository;
  let mockModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    deleteMany: jest.Mock;
    aggregate: jest.Mock;
    bulkWrite: jest.Mock;
    countDocuments: jest.Mock;
    new: jest.Mock;
  };

  beforeEach(async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
      select: jest.fn().mockReturnThis(),
    };
    mockModel = {
      find: jest.fn().mockReturnValue(chain),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      deleteMany: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) }),
      aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ count: 0 }]) }),
      bulkWrite: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
      new: jest.fn().mockImplementation((attrs: any) => ({
        save: jest.fn().mockResolvedValue(attrs),
        ...attrs,
      })),
    };
    (mockModel as any).prototype = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TermPostingsRepository,
        {
          provide: getModelToken(TermPostings.name),
          useValue: Object.assign(function (attrs: any) {
            return { save: jest.fn().mockResolvedValue(attrs), ...attrs };
          }, mockModel),
        },
      ],
    }).compile();

    repo = module.get<TermPostingsRepository>(TermPostingsRepository);
  });

  it('should be defined', () => {
    expect(repo).toBeDefined();
  });

  describe('findByIndexAwareTerm', () => {
    it('should merge chunks and return one logical doc', async () => {
      const chunks = [
        { term: 'idx:name:x', postings: { doc1: { docId: 'doc1', frequency: 1, positions: [0] } } },
        { term: 'idx:name:x', postings: { doc2: { docId: 'doc2', frequency: 1, positions: [0] } } },
      ];
      (mockModel.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(chunks),
      });

      const result = await repo.findByIndexAwareTerm('idx:name:x');

      expect(result).not.toBeNull();
      expect(result!.term).toBe('idx:name:x');
      expect(result!.documentCount).toBe(2);
      expect(Object.keys(result!.postings)).toEqual(expect.arrayContaining(['doc1', 'doc2']));
    });

    it('should return null when no chunks', async () => {
      (mockModel.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });
      const result = await repo.findByIndexAwareTerm('idx:name:x');
      expect(result).toBeNull();
    });
  });

  describe('update (chunking)', () => {
    it('should split postings into chunks of MAX_POSTINGS_PER_CHUNK', async () => {
      const postings: Record<string, PostingEntry> = {};
      for (let i = 0; i < MAX_POSTINGS_PER_CHUNK + 100; i++) {
        postings[`doc-${i}`] = { docId: `doc-${i}`, frequency: 1, positions: [0] };
      }
      (mockModel.findOneAndUpdate as jest.Mock).mockReturnValue({
        exec: jest.fn().mockResolvedValue({}),
      });
      (mockModel.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });
      // update(): first find() is toDelete (.select().lean().exec()); second find() is inside findByIndexAwareTerm (.sort().lean().exec())
      (mockModel.find as jest.Mock)
        .mockReturnValueOnce({
          sort: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce({
          sort: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        });

      await repo.update('idx:name:large', postings);

      expect(mockModel.findOneAndUpdate).toHaveBeenCalled();
      const calls = (mockModel.findOneAndUpdate as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls[0][0]).toEqual({ indexName: 'idx', term: 'idx:name:large', chunkIndex: 0 });
    });
  });

  describe('deleteByIndexAwareTerm', () => {
    it('should delete all chunks for term', async () => {
      (mockModel.deleteMany as jest.Mock).mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 3 }),
      });
      const ok = await repo.deleteByIndexAwareTerm('idx:name:x');
      expect(ok).toBe(true);
      expect(mockModel.deleteMany).toHaveBeenCalledWith({ indexName: 'idx', term: 'idx:name:x' });
    });
  });
});
