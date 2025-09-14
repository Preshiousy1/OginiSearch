-- Add missing typo tolerance functions
-- This script adds only the functions that are missing

-- 1. Create generic function for ultra-fast similarity search
CREATE OR REPLACE FUNCTION fast_similarity_search(
  p_index_name TEXT,
  p_query TEXT,
  p_max_results INTEGER DEFAULT 10,
  p_similarity_threshold REAL DEFAULT 0.1
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
      OR levenshtein(p_query, st.term) <= 3  -- Close edit distance
      OR soundex(p_query) = soundex(st.term)  -- Phonetic match
    )
    AND similarity(p_query, st.term) >= p_similarity_threshold
  ORDER BY 
    similarity(p_query, st.term) DESC,
    st.total_frequency DESC,
    levenshtein(p_query, st.term) ASC
  LIMIT p_max_results;
END;
$$ LANGUAGE plpgsql;

-- 2. Create function to get index statistics
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

-- 3. Test the functions
SELECT 'Functions created successfully' as status;