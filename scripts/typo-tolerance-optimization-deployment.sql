-- ============================================================================
-- TYPO TOLERANCE OPTIMIZATION - DEPLOYMENT VERSION (NO CONCURRENTLY)
-- ============================================================================
-- This script creates generic, index-agnostic optimizations for typo tolerance
-- Modified for deployment via debug endpoints (removes CONCURRENTLY keyword)

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE EXTENSION IF NOT EXISTS btree_gin;

-- 2. Create generic search terms materialized view
-- This dynamically extracts terms from any JSON field structure

-- Drop existing materialized view if it exists
DROP MATERIALIZED VIEW IF EXISTS search_terms;


CREATE MATERIALIZED VIEW search_terms AS
WITH term_extraction AS (
  -- Extract terms from all JSON fields dynamically
  SELECT 
    d.index_name,
    'json_field' as field_type,
    LOWER(TRIM(value)) as term,
    COUNT(*) as frequency,
    key as source_field
  FROM documents d,
       LATERAL jsonb_each_text(d.content) AS kv(key, value)
  WHERE d.content IS NOT NULL 
    AND value IS NOT NULL
    AND LENGTH(TRIM(value)) BETWEEN 3 AND 100
    AND value ~ '^[a-zA-Z0-9\s&.-]+$'
    AND key NOT LIKE '%_id'  -- Exclude ID fields
    AND key NOT LIKE '%url%'  -- Exclude URL fields
    AND key NOT LIKE '%email%'  -- Exclude email fields
  GROUP BY d.index_name, LOWER(TRIM(value)), key
  
  UNION ALL

-- Extract individual words from longer text fields
SELECT 
    d.index_name,
    'word' as field_type,
    LOWER(TRIM(word)) as term,
    COUNT(*) as frequency,
    key as source_field
  FROM documents d,
       LATERAL jsonb_each_text(d.content) AS kv(key, value),
       LATERAL unnest(string_to_array(value, ' ')) AS word
  WHERE d.content IS NOT NULL 
    AND value IS NOT NULL
    AND LENGTH(value) BETWEEN 10 AND 500  -- Only longer text fields
    AND key IN ('description', 'content', 'text', 'details', 'summary')
    AND LENGTH(TRIM(word)) > 2
    AND word ~ '^[a-zA-Z0-9]+$'  -- Only alphanumeric words
  GROUP BY d.index_name, LOWER(TRIM(word)), key
)
SELECT 
  index_name,
  field_type,
  term,
  SUM(frequency) as total_frequency,
  array_agg(DISTINCT source_field) as source_fields,
  -- Pre-compute trigrams for faster similarity search
  show_trgm(term) as trigrams
FROM term_extraction
WHERE term IS NOT NULL 
  AND term != ''
  AND LENGTH(term) > 2
  -- Filter out common stop words
  AND term NOT IN ('the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'had', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'boy', 'did', 'man', 'men', 'put', 'say', 'she', 'too', 'use')
GROUP BY index_name, field_type, term
HAVING SUM(frequency) >= 2;
-- Minimum frequency threshold

-- 3. Create high-performance indexes on the materialized view (NO CONCURRENTLY for deployment)
CREATE INDEX IF NOT EXISTS idx_search_terms_gin_trgm ON search_terms USING GIN (term gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_search_terms_gist_trgm ON search_terms USING GIST (term gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_search_terms_btree ON search_terms (index_name, term);

CREATE INDEX IF NOT EXISTS idx_search_terms_frequency ON search_terms (
    index_name,
    total_frequency DESC
);

-- 4. Create generic function for ultra-fast similarity search
CREATE OR REPLACE FUNCTION fast_similarity_search(
  p_index_name TEXT,
  p_query TEXT,
  p_max_results INTEGER DEFAULT 10,
  p_similarity_threshold REAL DEFAULT 0.3
) RETURNS TABLE (
  term TEXT,
  frequency INTEGER,
  similarity_score REAL,
  edit_distance INTEGER,
  source_fields TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    st.term,
    st.total_frequency::INTEGER,
    similarity(p_query, st.term) as similarity_score,
    levenshtein(p_query, st.term) as edit_distance,
    st.source_fields
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

-- 5. Create generic function for prefix-based autocomplete
CREATE OR REPLACE FUNCTION fast_prefix_search(
  p_index_name TEXT,
  p_prefix TEXT,
  p_max_results INTEGER DEFAULT 5
) RETURNS TABLE (
  term TEXT,
  frequency INTEGER,
  source_fields TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    st.term,
    st.total_frequency::INTEGER,
    st.source_fields
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

-- 6. Create generic function to refresh materialized view for specific index
CREATE OR REPLACE FUNCTION refresh_search_terms_for_index(p_index_name TEXT)
RETURNS VOID AS $$
BEGIN
  -- Delete existing terms for this index
  DELETE FROM search_terms WHERE index_name = p_index_name;
  
  -- Re-insert terms for this index
  INSERT INTO search_terms 
  SELECT * FROM (
    WITH term_extraction AS (
      -- Extract terms from all JSON fields dynamically
      SELECT 
        d.index_name,
        'json_field' as field_type,
        LOWER(TRIM(value)) as term,
        COUNT(*) as frequency,
        key as source_field
      FROM documents d,
           LATERAL jsonb_each_text(d.content) AS kv(key, value)
      WHERE d.index_name = p_index_name
        AND d.content IS NOT NULL 
        AND value IS NOT NULL
        AND LENGTH(TRIM(value)) BETWEEN 3 AND 100
        AND value ~ '^[a-zA-Z0-9\s&.-]+$'
        AND key NOT LIKE '%_id'
        AND key NOT LIKE '%url%'
        AND key NOT LIKE '%email%'
      GROUP BY d.index_name, LOWER(TRIM(value)), key
      
      UNION ALL
      
      -- Extract individual words from longer text fields
      SELECT 
        d.index_name,
        'word' as field_type,
        LOWER(TRIM(word)) as term,
        COUNT(*) as frequency,
        key as source_field
      FROM documents d,
           LATERAL jsonb_each_text(d.content) AS kv(key, value),
           LATERAL unnest(string_to_array(value, ' ')) AS word
      WHERE d.index_name = p_index_name
        AND d.content IS NOT NULL 
        AND value IS NOT NULL
        AND LENGTH(value) BETWEEN 10 AND 500
        AND key IN ('description', 'content', 'text', 'details', 'summary')
        AND LENGTH(TRIM(word)) > 2
        AND word ~ '^[a-zA-Z0-9]+$'
      GROUP BY d.index_name, LOWER(TRIM(word)), key
    )
    SELECT 
      index_name,
      field_type,
      term,
      SUM(frequency) as total_frequency,
      array_agg(DISTINCT source_field) as source_fields,
      show_trgm(term) as trigrams
    FROM term_extraction
    WHERE term IS NOT NULL 
      AND term != ''
      AND LENGTH(term) > 2
      AND term NOT IN ('the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'had', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'boy', 'did', 'man', 'men', 'put', 'say', 'she', 'too', 'use')
    GROUP BY index_name, field_type, term
    HAVING SUM(frequency) >= 2
  ) AS new_terms;
END;
$$ LANGUAGE plpgsql;

-- 7. Create monitoring view for performance analysis
CREATE OR REPLACE VIEW typo_tolerance_performance AS
SELECT
    st.index_name,
    COUNT(*) as total_terms,
    AVG(st.total_frequency) as avg_frequency,
    MAX(st.total_frequency) as max_frequency,
    COUNT(DISTINCT st.field_type) as field_types,
    pg_size_pretty (
        pg_total_relation_size ('search_terms')
    ) as materialized_view_size
FROM search_terms st
GROUP BY
    st.index_name;

-- 8. Create function to get index statistics
CREATE OR REPLACE FUNCTION get_index_typo_stats(p_index_name TEXT)
RETURNS TABLE (
  total_terms BIGINT,
  avg_frequency NUMERIC,
  max_frequency BIGINT,
  field_types BIGINT,
  top_terms TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_terms,
    AVG(st.total_frequency) as avg_frequency,
    MAX(st.total_frequency) as max_frequency,
    COUNT(DISTINCT st.field_type) as field_types,
    ARRAY(
      SELECT term 
      FROM search_terms 
      WHERE index_name = p_index_name 
      ORDER BY total_frequency DESC 
      LIMIT 10
    ) as top_terms
  FROM search_terms st
  WHERE st.index_name = p_index_name;
END;
$$ LANGUAGE plpgsql;

-- 9. Initial refresh of the materialized view
REFRESH MATERIALIZED VIEW search_terms;

-- 10. Display initial statistics
SELECT
    'Initial setup complete' as status,
    COUNT(*) as total_terms,
    COUNT(DISTINCT index_name) as total_indices
FROM search_terms;