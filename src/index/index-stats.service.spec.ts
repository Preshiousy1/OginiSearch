import { Test, TestingModule } from '@nestjs/testing';
import { IndexStatsService } from './index-stats.service';

describe('IndexStatsService', () => {
  let service: IndexStatsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IndexStatsService],
    }).compile();

    service = module.get<IndexStatsService>(IndexStatsService);
    service.reset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('document statistics', () => {
    it('should track total document count', () => {
      expect(service.totalDocuments).toBe(0);

      service.updateDocumentStats('doc1', { title: 5, body: 100 });
      expect(service.totalDocuments).toBe(1);

      service.updateDocumentStats('doc2', { title: 3, body: 50 });
      expect(service.totalDocuments).toBe(2);

      service.updateDocumentStats('doc1', {}, true); // remove
      expect(service.totalDocuments).toBe(1);
    });

    it('should track field lengths', () => {
      service.updateDocumentStats('doc1', { title: 5, body: 100 });

      expect(service.getFieldLength('doc1', 'title')).toBe(5);
      expect(service.getFieldLength('doc1', 'body')).toBe(100);
      expect(service.getFieldLength('doc1', 'nonexistent')).toBe(0);
      expect(service.getFieldLength('nonexistent', 'title')).toBe(0);
    });

    it('should calculate average field lengths', () => {
      service.updateDocumentStats('doc1', { title: 10, body: 100 });
      service.updateDocumentStats('doc2', { title: 20, body: 200 });

      expect(service.getAverageFieldLength('title')).toBe(15); // (10 + 20) / 2
      expect(service.getAverageFieldLength('body')).toBe(150); // (100 + 200) / 2

      service.updateDocumentStats('doc3', { title: 30 }); // no body field
      expect(service.getAverageFieldLength('title')).toBe(20); // (10 + 20 + 30) / 3
      expect(service.getAverageFieldLength('body')).toBe(100); // (100 + 200 + 0) / 3
    });

    it('should remove document statistics', () => {
      service.updateDocumentStats('doc1', { title: 10, body: 100 });
      service.updateDocumentStats('doc2', { title: 20, body: 200 });

      service.updateDocumentStats('doc1', { title: 10, body: 100 }, true);

      expect(service.totalDocuments).toBe(1);
      expect(service.getFieldLength('doc1', 'title')).toBe(0);
      expect(service.getAverageFieldLength('title')).toBe(20); // Only doc2 remains
    });
  });

  describe('term statistics', () => {
    it('should track document frequencies', () => {
      expect(service.getDocumentFrequency('test')).toBe(0);

      service.updateTermStats('test', 'doc1');
      expect(service.getDocumentFrequency('test')).toBe(1);

      service.updateTermStats('test', 'doc2');
      expect(service.getDocumentFrequency('test')).toBe(2);

      service.updateTermStats('test', 'doc1', true); // remove
      expect(service.getDocumentFrequency('test')).toBe(1);

      service.updateTermStats('test', 'doc2', true); // remove
      expect(service.getDocumentFrequency('test')).toBe(0);
    });

    it('should handle multiple terms', () => {
      service.updateTermStats('apple', 'doc1');
      service.updateTermStats('banana', 'doc1');
      service.updateTermStats('apple', 'doc2');

      expect(service.getDocumentFrequency('apple')).toBe(2);
      expect(service.getDocumentFrequency('banana')).toBe(1);
      expect(service.getDocumentFrequency('cherry')).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear all statistics', () => {
      service.updateDocumentStats('doc1', { title: 5, body: 100 });
      service.updateTermStats('test', 'doc1');

      service.reset();

      expect(service.totalDocuments).toBe(0);
      expect(service.getDocumentFrequency('test')).toBe(0);
      expect(service.getFieldLength('doc1', 'title')).toBe(0);
      expect(service.getAverageFieldLength('title')).toBe(0);
    });
  });
});
