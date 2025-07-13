# Term-Posting Removal Checklist
## MongoDB Components to Remove Before PostgreSQL Migration

This checklist tracks the removal of MongoDB term-posting infrastructure before implementing PostgreSQL-based search.

---

## **Files to Delete Completely:**
- [ ] `src/storage/mongodb/schemas/term-postings.schema.ts`
- [ ] `src/storage/mongodb/repositories/term-postings.repository.ts` 
- [ ] `src/storage/index-storage/persistent-term-dictionary.service.ts`

---

## **Files to Clean Up (Remove Term-Posting Dependencies):**

### **1. `src/storage/mongodb/mongodb.module.ts`**
- [ ] Remove `TermPostings` and `TermPostingsSchema` imports
- [ ] Remove `TermPostingsRepository` import and export
- [ ] Remove `TermPostings` from MongooseModule.forFeature()

### **2. `src/api/controllers/index.controller.ts`**
- [ ] Remove `TermPostingsRepository` import (line 35)
- [ ] Remove `termPostingsRepository` from constructor
- [ ] Remove `enableTermPostingsPersistence` from DTOs
- [ ] Remove API endpoints:
  - [ ] `migrateTermPostings()` (line 757)
  - [ ] `clearIndexTermPostings()` (line 820) 
  - [ ] `debugTermPostings()` (line 1119)
- [ ] Remove term-posting references from:
  - [ ] `getIndexInfo()` method
  - [ ] `resetSystem()` method
  - [ ] `getSystemHealth()` method

### **3. `src/search/search-executor.service.ts`**
- [ ] Remove `TermPostingsRepository` import (line 16)
- [ ] Remove `termPostingsRepository` from constructor
- [ ] Remove `getPostingListByIndexAwareTerm()` method (lines 186-227)
- [ ] Remove `getIndexAwareTermPostings()` method (line 231+)
- [ ] Update search execution to use in-memory data only

### **4. `src/indexing/indexing.service.ts`**
- [ ] Remove `persistTermPostingsToMongoDB()` method (lines 360-431)
- [ ] Remove calls to `persistentTermDictionary.saveTermPostings()`
- [ ] Remove calls to `persistentTermDictionary.deleteTermPostings()`

### **5. `src/storage/index-storage/index-restoration.service.ts`**
- [ ] Remove `restoreAllTermPostings()` method (line 124+)
- [ ] Remove `migrateTermPostings()` calls (line 71)
- [ ] Remove `restoreTermPostings()` calls (line 139)

### **6. `src/document/document.service.ts`**
- [ ] Remove `enableTermPostingsPersistence` parameter from methods
- [ ] Remove `persistTermPostingsToMongoDB()` calls (line 420)

### **7. `src/indexing/memory-optimized-indexing.service.ts`**
- [ ] Remove term-posting storage logic (lines 240-242, 299-307)
- [ ] Update to use in-memory storage only

### **8. `src/storage/index-storage/index-storage.service.ts`**
- [ ] Remove `storeTermPostings()` method (line 254+)
- [ ] Remove `deleteTermPostings()` method (line 269+)
- [ ] Remove `getTermPostings()` method (line 274+)

---

## **Test Files to Update:**
- [ ] `src/indexing/indexing.service.spec.ts` - Remove term-posting mocks
- [ ] `src/storage/index-storage/index-storage.service.spec.ts` - Remove term-posting tests

---

## **Documentation to Update:**
- [ ] `ogini-api-documentation.md` - Remove term-posting API docs
- [ ] `docs/bug-fixes/TERM_POSTINGS_PERSISTENCE_SOLUTION.md` - Mark as legacy

---

## **Progress Tracking:**
- **Status**: Ready to start removal
- **Phase**: Pre-PostgreSQL cleanup 
- **Next**: Implement Tasks 1.1 (PostgreSQL Setup) and 1.2 (Analysis Adapter)

---

**Note**: This removal will transition the system from MongoDB term-posting storage to PostgreSQL-based full-text search, eliminating the broken term-posting persistence issue while maintaining all search functionality through PostgreSQL's native capabilities. 