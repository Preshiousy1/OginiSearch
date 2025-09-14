-- ============================================================================
-- POSTGRESQL OPTIMIZATIONS FOR TYPO TOLERANCE
-- ============================================================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- 2. Create optimized term dictionary table (materialized view)
-- This pre-computes all searchable terms with frequencies
CREATE MATERIALIZED VIEW search_terms AS
WITH term_extraction AS (
  SELECT 
    index_name,
    'name' as field_type,
    LOWER(TRIM(content->>'name')) as term,
    COUNT(*) as frequency
  FROM documents 
  WHERE content->>'name' IS NOT NULL 
    AND LENGTH(TRIM(content->>'name')) BETWEEN 3 AND 50
    AND content->>'name' ~ '^[a-zA-Z0-9\s&.-]+$'
  GROUP BY index_name, LOWER(TRIM(content->>'name'))
  
  UNION ALL
  
  SELECT 
    index_name,
    'category' as field_type,
    LOWER(TRIM(content->>'category_name')) as term,
    COUNT(*) as frequency
  FROM documents 
  WHERE content->>'category_name' IS NOT NULL 
    AND LENGTH(TRIM(content->>'category_name')) BETWEEN 3 AND 50
    AND content->>'category_name' ~ '^[a-zA-Z0-9\s&.-]+$'
  GROUP BY index_name, LOWER(TRIM(content->>'category_name'))
  
  UNION ALL
  
  SELECT 
    index_name,
    'description' as field_type,
    unnest(string_to_array(LOWER(content->>'description'), ' ')) as term,
    COUNT(*) as frequency
  FROM documents 
  WHERE content->>'description' IS NOT NULL 
    AND LENGTH(content->>'description') < 500
  GROUP BY index_name, unnest(string_to_array(LOWER(content->>'description'), ' '))
  HAVING LENGTH(unnest(string_to_array(LOWER(content->>'description'), ' '))) > 2
)
SELECT 
  index_name,
  field_type,
  term,
  SUM(frequency) as total_frequency,
  -- Pre-compute trigrams for faster similarity search
  show_trgm(term) as trigrams
FROM term_extraction
WHERE term IS NOT NULL 
  AND term != ''
  AND LENGTH(term) > 2
GROUP BY index_name, field_type, term
HAVING SUM(frequency) >= 2;

-- 3. Create high-performance indexes on the materialized view
CREATE INDEX CONCURRENTLY idx_search_terms_gin_trgm 
ON search_terms USING GIN (term gin_trgm_ops);

CREATE INDEX CONCURRENTLY idx_search_terms_gist_trgm 
ON search_terms USING GIST (term gist_trgm_ops);

CREATE INDEX CONCURRENTLY idx_search_terms_btree 
ON search_terms (index_name, term);

CREATE INDEX CONCURRENTLY idx_search_terms_frequency 
ON search_terms (index_name, total_frequency DESC);

-- 4. Create function for ultra-fast similarity search
CREATE OR REPLACE FUNCTION fast_similarity_search(
  p_index_name TEXT,
  p_query TEXT,
  p_max_results INTEGER DEFAULT 10,
  p_similarity_threshold REAL DEFAULT 0.3
) RETURNS TABLE (
  term TEXT,
  frequency INTEGER,
  similarity_score REAL,
  edit_distance INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    st.term,
    st.total_frequency::INTEGER,
    similarity(p_query, st.term) as similarity_score,
    levenshtein(p_query, st.term) as edit_distance
  FROM search_terms st
  WHERE st.index_name = p_index_name
    AND (
      st.term % p_query  -- Use trigram similarity operator
      OR st.term ILIKE p_query || '%'  -- Prefix match
      OR st.term ILIKE '%' || p_query || '%'  -- Contains match
    )
    AND similarity(p_query, st.term) >= p_similarity_threshold
  ORDER BY 
    similarity(p_query, st.term) DESC,
    st.total_frequency DESC,
    levenshtein(p_query, st.term) ASC
  LIMIT p_max_results;
END;
$$ LANGUAGE plpgsql;

-- 5. Create function for prefix-based autocomplete
CREATE OR REPLACE FUNCTION fast_prefix_search(
  p_index_name TEXT,
  p_prefix TEXT,
  p_max_results INTEGER DEFAULT 5
) RETURNS TABLE (
  term TEXT,
  frequency INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    st.term,
    st.total_frequency::INTEGER
  FROM search_terms st
  WHERE st.index_name = p_index_name
    AND st.term ILIKE p_prefix || '%'
  ORDER BY 
    CASE WHEN st.term = p_prefix THEN 0 ELSE 1 END,  -- Exact match first
    LENGTH(st.term),  -- Shorter terms first
    st.total_frequency DESC
  LIMIT p_max_results;
END;
$$ LANGUAGE plpgsql;

-- 6. Create optimized main document indexes
CREATE INDEX CONCURRENTLY idx_documents_composite_search 
ON documents USING GIN (
  index_name,
  (content->>'name') gin_trgm_ops,
  (content->>'category_name') gin_trgm_ops
) WHERE content IS NOT NULL;

-- 7. Create specialized indexes for exact matching (faster than trigram for equals)
CREATE INDEX CONCURRENTLY idx_documents_name_exact 
ON documents (index_name, LOWER(content->>'name')) 
WHERE content->>'name' IS NOT NULL;

CREATE INDEX CONCURRENTLY idx_documents_category_exact 
ON documents (index_name, LOWER(content->>'category_name')) 
WHERE content->>'category_name' IS NOT NULL;

-- 8. Create function to refresh the materialized view efficiently
CREATE OR REPLACE FUNCTION refresh_search_terms(p_index_name TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF p_index_name IS NOT NULL THEN
    -- Partial refresh for specific index (requires PostgreSQL 14+)
    -- For older versions, this would need to be a full refresh
    DELETE FROM search_terms WHERE index_name = p_index_name;
    
    INSERT INTO search_terms 
    SELECT * FROM (
      WITH term_extraction AS (
        SELECT 
          index_name,
          'name' as field_type,
          LOWER(TRIM(content->>'name')) as term,
          COUNT(*) as frequency
        FROM documents 
        WHERE index_name = p_index_name
          AND content->>'name' IS NOT NULL 
          AND LENGTH(TRIM(content->>'name')) BETWEEN 3 AND 50
          AND content->>'name' ~ '^[a-zA-Z0-9\s&.-]+$'
        GROUP BY index_name, LOWER(TRIM(content->>'name'))
        
        UNION ALL
        
        SELECT 
          index_name,
          'category' as field_type,
          LOWER(TRIM(content->>'category_name')) as term,
          COUNT(*) as frequency
        FROM documents 
        WHERE index_name = p_index_name
          AND content->>'category_name' IS NOT NULL 
          AND LENGTH(TRIM(content->>'category_name')) BETWEEN 3 AND 50
          AND content->>'category_name' ~ '^[a-zA-Z0-9\s&.-]+$'
        GROUP BY index_name, LOWER(TRIM(content->>'category_name'))
      )
      SELECT 
        index_name,
        field_type,
        term,
        SUM(frequency) as total_frequency,
        show_trgm(term) as trigrams
      FROM term_extraction
      WHERE term IS NOT NULL 
        AND term != ''
        AND LENGTH(term) > 2
      GROUP BY index_name, field_type, term
      HAVING SUM(frequency) >= 2
    ) AS new_terms;
  ELSE
    -- Full refresh
    REFRESH MATERIALIZED VIEW CONCURRENTLY search_terms;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 9. Performance tuning settings (adjust based on your server)
-- Add these to postgresql.conf:

/*
# Memory settings for better performance
shared_buffers = 256MB                    # Increase based on available RAM
work_mem = 64MB                          # Increase for complex queries
maintenance_work_mem = 256MB             # Increase for index building
effective_cache_size = 1GB               # Set to ~75% of available RAM

# GIN-specific settings
gin_fuzzy_search_limit = 0               # Disable limit for accuracy
gin_pending_list_limit = 4MB            # Increase for better write performance

# Trigram-specific settings
pg_trgm.similarity_threshold = 0.3       # Adjust based on your needs
pg_trgm.word_similarity_threshold = 0.6  # For word similarity

# Query planner settings
random_page_cost = 1.1                   # Lower for SSD storage
seq_page_cost = 1.0                      # Default for SSD
cpu_tuple_cost = 0.01                    # Default
cpu_index_tuple_cost = 0.005             # Default
cpu_operator_cost = 0.0025               # Default
*/

-- 10. Create monitoring views for performance analysis
CREATE VIEW typo_tolerance_performance AS
SELECT 
  st.index_name,
  COUNT(*) as total_terms,
  AVG(st.total_frequency) as avg_frequency,
  MAX(st.total_frequency) as max_frequency,
  COUNT(DISTINCT st.field_type) as field_types,
  pg_size_pretty(pg_total_relation_size('search_terms')) as materialized_view_size
FROM search_terms st
GROUP BY st.index_name;

-- 11. Example usage queries (these should be sub-millisecond after optimization)

-- Fast similarity search
SELECT * FROM fast_similarity_search('your_index_name', 'resturant', 5);

-- Fast prefix search
SELECT * FROM fast_prefix_search('your_index_name', 'rest', 5);

-- Manual similarity search with distance ordering (GiST index)
SELECT 
  term,
  total_frequency,
  term <-> 'restaurant' as distance_score,
  similarity('restaurant', term) as similarity_score
FROM search_terms 
WHERE index_name = 'your_index_name'
  AND term % 'restaurant'
ORDER BY term <-> 'restaurant'
LIMIT 10;

-- Exact match with fallback to similarity
WITH exact_matches AS (
  SELECT term, total_frequency, 1.0 as match_score
  FROM search_terms 
  WHERE index_name = 'your_index_name'
    AND term = LOWER('restaurant')
),
similarity_matches AS (
  SELECT term, total_frequency, similarity('restaurant', term) as match_score
  FROM search_terms 
  WHERE index_name = 'your_index_name'
    AND term % 'restaurant'
    AND term != LOWER('restaurant')
  ORDER BY similarity('restaurant', term) DESC
  LIMIT 5
)
SELECT * FROM exact_matches
UNION ALL
SELECT * FROM similarity_matches
ORDER BY match_score DESC, total_frequency DESC;