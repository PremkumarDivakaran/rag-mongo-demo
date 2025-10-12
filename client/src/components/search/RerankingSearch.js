import React, { useState, useCallback } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Chip,
  Alert,
  Collapse,
  IconButton,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  Divider,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  Slider
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import ArticleIcon from '@mui/icons-material/Article';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import InfoIcon from '@mui/icons-material/Info';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import { useSnackbar } from 'notistack';

const API_BASE = 'http://localhost:3001/api';

function RerankingSearch() {
  const [query, setQuery] = useState('Share Diagnostic Reports with Patients via WhatsApp');
  const [limit, setLimit] = useState(10);
  const [rerankTopK, setRerankTopK] = useState(50);
  const [fusionMethod, setFusionMethod] = useState('rrf');
  const [bm25Weight, setBm25Weight] = useState(40);
  const [vectorWeight, setVectorWeight] = useState(60);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [beforeResults, setBeforeResults] = useState([]);
  const [afterResults, setAfterResults] = useState([]);
  const [searchInfo, setSearchInfo] = useState(null);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showWeights, setShowWeights] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ modules: [], priorities: [], risks: [], types: [] });
  const [moduleFilter, setModuleFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [automationFilter, setAutomationFilter] = useState('');
  const [tabValue, setTabValue] = useState(0);
  const { enqueueSnackbar } = useSnackbar();

  const loadFilterOptions = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/metadata/distinct`);
      const data = await response.json();
      
      if (data.success && data.data) {
        setFilterOptions(data.data);
      } else {
        setFilterOptions({ modules: [], priorities: [], risks: [], types: [] });
      }
    } catch (err) {
      console.error('Failed to load filter options:', err);
      setFilterOptions({ modules: [], priorities: [], risks: [], types: [] });
    }
  }, []);

  React.useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

  const handleSearch = async () => {
    if (!query.trim()) {
      enqueueSnackbar('Please enter a search query', { variant: 'warning' });
      return;
    }

    setSearching(true);
    setError(null);
    setResults([]);
    setBeforeResults([]);
    setAfterResults([]);
    setSearchInfo(null);

    try {
      const filters = {};
      if (moduleFilter) filters.module = moduleFilter;
      if (priorityFilter) filters.priority = priorityFilter;
      if (riskFilter) filters.risk = riskFilter;
      if (automationFilter) filters.automationManual = automationFilter;

      const response = await fetch(`${API_BASE}/search/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          limit,
          rerankTopK,
          fusionMethod,
          bm25Weight: bm25Weight / 100,
          vectorWeight: vectorWeight / 100,
          filters
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      if (data.success) {
        setResults(data.results);
        setBeforeResults(data.beforeReranking);
        setAfterResults(data.afterReranking);
        setSearchInfo({
          count: data.count,
          totalCandidates: data.totalCandidates,
          searchTime: data.searchTime,
          rerankingTime: data.rerankingTime,
          totalTime: data.totalTime,
          query: data.query,
          filters: data.filters,
          fusionMethod: data.fusionMethod,
          reranked: data.reranked,
          weights: data.weights,
          stats: data.stats || {}
        });
        enqueueSnackbar(`Found ${data.count} results with ${data.fusionMethod.toUpperCase()} score fusion`, { variant: 'success' });
      }
    } catch (err) {
      setError(err.message);
      enqueueSnackbar(err.message, { variant: 'error' });
    } finally {
      setSearching(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !searching) {
      handleSearch();
    }
  };

  const formatScore = (score) => {
    return score ? score.toFixed(4) : '0.0000';
  };

  const getScoreColor = (score) => {
    // Use normalized score thresholds (0-1 range)
    if (score >= 0.8) return 'success';
    if (score >= 0.6) return 'info';
    if (score >= 0.4) return 'warning';
    return 'error';
  };

  const getRankChangeIcon = (rankChange) => {
    if (rankChange > 0) return <TrendingUpIcon fontSize="small" color="success" />;
    if (rankChange < 0) return <TrendingDownIcon fontSize="small" color="error" />;
    return <SwapVertIcon fontSize="small" color="disabled" />;
  };

  const getRankChangeColor = (rankChange) => {
    if (rankChange > 0) return 'success';
    if (rankChange < 0) return 'error';
    return 'default';
  };

  return (
    <Box sx={{ maxWidth: 1400, margin: 'auto', padding: 3 }}>
      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <MergeTypeIcon sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
          <Typography variant="h4" component="h1">
            Score Fusion Reranking
          </Typography>
        </Box>
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Combines BM25 keyword search and Vector semantic search using advanced score fusion techniques (RRF, Weighted, Reciprocal).
        </Typography>

        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Search Query"
              variant="outlined"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="e.g., merge UHID, patient registration, login tests..."
              disabled={searching}
               sx={{ 
                '& .MuiOutlinedInput-root': { 
                  minWidth: '800px',
                  width: '100%'
                } 
              }}
            />
          </Grid>

          <Grid item xs={6} md={2}>
            <FormControl fullWidth>
              <InputLabel>Fusion Method</InputLabel>
              <Select
                value={fusionMethod}
                onChange={(e) => setFusionMethod(e.target.value)}
                label="Fusion Method"
                disabled={searching}
              >
                <MenuItem value="rrf">RRF (Reciprocal Rank)</MenuItem>
                <MenuItem value="weighted">Weighted Scores</MenuItem>
                <MenuItem value="reciprocal">Reciprocal Rank</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={6} md={2}>
            <TextField
              fullWidth
              label="Top-K Candidates"
              type="number"
              variant="outlined"
              value={rerankTopK}
              onChange={(e) => setRerankTopK(Math.max(10, Math.min(100, parseInt(e.target.value) || 50)))}
              disabled={searching}
              inputProps={{ min: 10, max: 100 }}
            />
          </Grid>

          <Grid item xs={6} md={1}>
            <TextField
              fullWidth
              label="Final Limit"
              type="number"
              variant="outlined"
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))}
              disabled={searching}
              inputProps={{ min: 1, max: 50 }}
            />
          </Grid>

          <Grid item xs={6} md={1}>
            <Button
              fullWidth
              variant="contained"
              color="primary"
              size="large"
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              startIcon={searching ? <CircularProgress size={20} /> : <SearchIcon />}
              sx={{ height: '56px' }}
            >
              {searching ? 'Searching...' : 'Search'}
            </Button>
          </Grid>
        </Grid>

        {/* Weight Controls */}
        {(fusionMethod === 'weighted' || fusionMethod === 'reciprocal') && (
          <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mr: 1 }}>
                Score Weights
              </Typography>
              <Tooltip title="Adjust the balance between BM25 keyword and Vector semantic scores">
                <IconButton size="small" onClick={() => setShowWeights(!showWeights)}>
                  <InfoIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            <Collapse in={showWeights}>
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>BM25 Weight:</strong> More weight = favor exact keyword matches<br />
                  <strong>Vector Weight:</strong> More weight = favor semantic similarity<br />
                  Total must equal 100%
                </Typography>
              </Alert>
            </Collapse>

            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" gutterBottom>
                  BM25 Weight: {bm25Weight}%
                </Typography>
                <Slider
                  value={bm25Weight}
                  onChange={(e, newValue) => {
                    setBm25Weight(newValue);
                    setVectorWeight(100 - newValue);
                  }}
                  min={0}
                  max={100}
                  step={5}
                  marks={[
                    { value: 0, label: '0%' },
                    { value: 50, label: '50%' },
                    { value: 100, label: '100%' }
                  ]}
                  valueLabelDisplay="auto"
                  disabled={searching}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Typography variant="body2" gutterBottom>
                  Vector Weight: {vectorWeight}%
                </Typography>
                <Slider
                  value={vectorWeight}
                  onChange={(e, newValue) => {
                    setVectorWeight(newValue);
                    setBm25Weight(100 - newValue);
                  }}
                  min={0}
                  max={100}
                  step={5}
                  marks={[
                    { value: 0, label: '0%' },
                    { value: 50, label: '50%' },
                    { value: 100, label: '100%' }
                  ]}
                  valueLabelDisplay="auto"
                  disabled={searching}
                />
              </Grid>
            </Grid>

            <Box sx={{ mt: 2 }}>
              <Button
                size="small"
                onClick={() => { setBm25Weight(50); setVectorWeight(50); }}
                variant="outlined"
              >
                Reset to 50/50
              </Button>
            </Box>
          </Paper>
        )}

        {/* Filters */}
        <Box sx={{ mt: 2 }}>
          <Button
            startIcon={<FilterListIcon />}
            endIcon={showFilters ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            onClick={() => setShowFilters(!showFilters)}
            size="small"
          >
            Filters
          </Button>

          <Collapse in={showFilters}>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Module</InputLabel>
                  <Select
                    value={moduleFilter}
                    onChange={(e) => setModuleFilter(e.target.value)}
                    label="Module"
                    sx={{ bgcolor: 'background.paper' , minWidth: '200px',width: '100%'}}
                  >
                    <MenuItem value="">All Modules</MenuItem>
                    {filterOptions.modules.map((module) => (
                      <MenuItem key={module} value={module}>{module}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Priority</InputLabel>
                  <Select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    label="Priority"
                    sx={{ bgcolor: 'background.paper' , minWidth: '200px',width: '100%'}}
                  >
                    <MenuItem value="">All Priorities</MenuItem>
                    {filterOptions.priorities.map((priority) => (
                      <MenuItem key={priority} value={priority}>{priority}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Risk</InputLabel>
                  <Select
                    value={riskFilter}
                    onChange={(e) => setRiskFilter(e.target.value)}
                    label="Risk"
                    sx={{ bgcolor: 'background.paper' , minWidth: '200px',width: '100%'}}
                  >
                    <MenuItem value="">All Risk Levels</MenuItem>
                    {filterOptions.risks.map((risk) => (
                      <MenuItem key={risk} value={risk}>{risk}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Type</InputLabel>
                  <Select
                    value={automationFilter}
                    onChange={(e) => setAutomationFilter(e.target.value)}
                    label="Type"
                    sx={{ bgcolor: 'background.paper' , minWidth: '200px',width: '100%'}}
                  >
                    <MenuItem value="">All Types</MenuItem>
                    {filterOptions.types.map((type) => (
                      <MenuItem key={type} value={type}>{type}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Collapse>
        </Box>
      </Paper>

      {/* Search Info */}
      {searchInfo && (
        <Alert 
          severity="success"
          icon={<MergeTypeIcon />}
          sx={{ mb: 3 }}
        >
          <Typography variant="body2">
            <strong>Score Fusion Results:</strong> Found {searchInfo.count} test cases using {searchInfo.fusionMethod?.toUpperCase()} method
            <br />
            <strong>Timing:</strong> Search: {searchInfo.searchTime}ms, 
            Fusion: {searchInfo.rerankingTime}ms, 
            Total: {searchInfo.totalTime}ms
            <br />
            <strong>Candidates:</strong> Retrieved {searchInfo.totalCandidates} candidates from BM25 + Vector, 
            fused and returned top {searchInfo.count}
            {searchInfo.stats?.topResultChanged && (
              <>
                <br />
                <strong>🔄 Top result changed after fusion!</strong>
              </>
            )}
            {searchInfo.stats?.foundInBoth !== undefined && (
              <>
                <br />
                <strong>📊 Coverage:</strong> {searchInfo.stats.foundInBoth} in both, 
                {searchInfo.stats.foundInBm25Only} BM25 only, 
                {searchInfo.stats.foundInVectorOnly} vector only
              </>
            )}
            {searchInfo.weights && (
              <>
                <br />
                <strong>⚖️ Weights:</strong> BM25: {(searchInfo.weights.bm25 * 100).toFixed(0)}%, 
                Vector: {(searchInfo.weights.vector * 100).toFixed(0)}%
              </>
            )}
          </Typography>
        </Alert>
      )}

      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Results with Before/After Tabs */}
      {results.length > 0 && (
        <Box>
          <Paper elevation={2} sx={{ mb: 3 }}>
            <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
              <Tab label="After Reranking (Final)" />
              <Tab label="Before Reranking (Original)" />
              <Tab label="Comparison Table" />
            </Tabs>
          </Paper>

          {/* Tab 0: After Reranking */}
          {tabValue === 0 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 2 }}>
                <ArticleIcon sx={{ verticalAlign: 'middle', mr: 1 }} />
                After Score Fusion ({afterResults.length} results)
              </Typography>

              {afterResults.map((result, index) => (
                <Card key={result._id || index} sx={{ mb: 2 }} elevation={2}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                      <Box sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                          <Chip 
                            label={`#${result.newRank || index + 1}`} 
                            size="small" 
                            color="primary" 
                            variant="outlined"
                          />
                          <Typography variant="h6" component="div">
                            {result.id || 'No ID'}
                          </Typography>
                          <Chip 
                            label={`Fused Score: ${formatScore(result.fusedScore)}`} 
                            color="success"
                            size="small"
                          />
                          <Chip 
                            label={`Found in: ${result.foundIn}`} 
                            color={result.foundIn === 'both' ? 'success' : result.foundIn === 'bm25' ? 'primary' : 'secondary'}
                            size="small"
                            variant="outlined"
                          />
                          {result.rankChange !== undefined && result.rankChange !== 0 && (
                            <Chip 
                              icon={getRankChangeIcon(result.rankChange)}
                              label={`${result.rankChange > 0 ? '+' : ''}${result.rankChange} positions`} 
                              color={getRankChangeColor(result.rankChange)}
                              size="small"
                              variant="outlined"
                            />
                          )}
                          {result.originalRank && (
                            <Chip 
                              label={`Was #${result.originalRank}`} 
                              size="small"
                              variant="outlined"
                            />
                          )}
                        </Box>

                        <Typography variant="h6" color="text.primary" sx={{ mb: 1 }}>
                          {result.title || 'No Title'}
                        </Typography>

                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                          {result.module && (
                            <Chip label={`Module: ${result.module}`} size="small" variant="outlined" />
                          )}
                          {result.priority && (
                            <Chip 
                              label={result.priority} 
                              size="small" 
                              color={result.priority === 'P1' ? 'error' : result.priority === 'P2' ? 'warning' : 'default'}
                            />
                          )}
                          {result.risk && (
                            <Chip 
                              label={`Risk: ${result.risk}`} 
                              size="small" 
                              color={result.risk === 'High' ? 'error' : result.risk === 'Medium' ? 'warning' : 'success'}
                              variant="outlined"
                            />
                          )}
                        </Box>

                        {result.description && (
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            <strong>Description:</strong> {result.description}
                          </Typography>
                        )}

                        <Divider sx={{ my: 1 }} />

                        {/* Score Breakdown */}
                        <Paper variant="outlined" sx={{ p: 1, bgcolor: 'grey.50' }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            <strong>Score Components:</strong>
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Typography variant="caption" color="text.secondary">
                              🔤 BM25: {formatScore(result.bm25Score)} (norm: {formatScore(result.bm25Normalized)})
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              🧠 Vector: {formatScore(result.vectorScore)} (norm: {formatScore(result.vectorNormalized)})
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              ⚡ Fused: {formatScore(result.fusedScore)}
                            </Typography>
                          </Box>
                          {result.fusionComponents && (
                            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 0.5 }}>
                              {Object.entries(result.fusionComponents).map(([key, value]) => (
                                <Typography key={key} variant="caption" color="text.secondary">
                                  {key}: {value}
                                </Typography>
                              ))}
                            </Box>
                          )}
                        </Paper>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}

          {/* Tab 1: Before Reranking */}
          {tabValue === 1 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 2 }}>
                <ArticleIcon sx={{ verticalAlign: 'middle', mr: 1 }} />
                Before Fusion - Original Results ({beforeResults.length} results)
              </Typography>

              {beforeResults.map((result, index) => (
                <Card key={result._id || index} sx={{ mb: 2 }} elevation={2}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                      <Box sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                          <Chip 
                            label={`#${index + 1}`} 
                            size="small" 
                            color="default" 
                            variant="outlined"
                          />
                          <Typography variant="h6" component="div">
                            {result.id || 'No ID'}
                          </Typography>
                          <Chip 
                            label={`Score: ${formatScore(result.vectorScore || result.bm25Score || 0)}`} 
                            color={getScoreColor(result.vectorScore || result.bm25Score || 0)}
                            size="small"
                          />
                        </Box>

                        <Typography variant="h6" color="text.primary" sx={{ mb: 1 }}>
                          {result.title || 'No Title'}
                        </Typography>

                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                          {result.module && (
                            <Chip label={`Module: ${result.module}`} size="small" variant="outlined" />
                          )}
                          {result.priority && (
                            <Chip 
                              label={result.priority} 
                              size="small" 
                              color={result.priority === 'P1' ? 'error' : result.priority === 'P2' ? 'warning' : 'default'}
                            />
                          )}
                        </Box>

                        {result.description && (
                          <Typography variant="body2" color="text.secondary">
                            <strong>Description:</strong> {result.description}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}

          {/* Tab 2: Comparison Table */}
          {tabValue === 2 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 2 }}>
                <CompareArrowsIcon sx={{ verticalAlign: 'middle', mr: 1 }} />
                Before vs After Comparison
              </Typography>

              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Original Rank</strong></TableCell>
                      <TableCell><strong>Test Case ID</strong></TableCell>
                      <TableCell><strong>Title</strong></TableCell>
                      <TableCell><strong>BM25 Score</strong></TableCell>
                      <TableCell><strong>Vector Score</strong></TableCell>
                      <TableCell><strong>Fused Score</strong></TableCell>
                      <TableCell><strong>New Rank</strong></TableCell>
                      <TableCell><strong>Change</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {afterResults.map((result) => (
                      <TableRow 
                        key={result._id}
                        sx={{ 
                          backgroundColor: Math.abs(result.rankChange) >= 5 ? 'action.hover' : 'inherit'
                        }}
                      >
                        <TableCell>#{result.originalRank}</TableCell>
                        <TableCell>{result.id}</TableCell>
                        <TableCell sx={{ maxWidth: 300 }}>
                          {result.title?.substring(0, 50)}{result.title?.length > 50 ? '...' : ''}
                        </TableCell>
                        <TableCell>{formatScore(result.bm25Score || 0)}</TableCell>
                        <TableCell>{formatScore(result.vectorScore || 0)}</TableCell>
                        <TableCell>
                          <Chip 
                            label={formatScore(result.fusedScore)} 
                            size="small" 
                            color="success"
                          />
                        </TableCell>
                        <TableCell>#{result.newRank}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {getRankChangeIcon(result.rankChange)}
                            <Typography 
                              variant="body2" 
                              color={result.rankChange > 0 ? 'success.main' : result.rankChange < 0 ? 'error.main' : 'text.secondary'}
                            >
                              {result.rankChange > 0 ? '+' : ''}{result.rankChange}
                            </Typography>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <Alert severity="info" icon={<InfoIcon />} sx={{ mt: 2 }}>
                <Typography variant="body2">
                  <strong>How to read this table:</strong><br />
                  • <strong>Positive change</strong> (↑): Result moved UP in ranking (better)<br />
                  • <strong>Negative change</strong> (↓): Result moved DOWN in ranking (worse)<br />
                  • <strong>Zero change</strong> (↔): Position remained the same<br />
                  • Highlighted rows indicate significant reorderings (±5 positions)
                </Typography>
              </Alert>
            </Box>
          )}
        </Box>
      )}

      {/* No Results Message */}
      {!searching && results.length === 0 && searchInfo && (
        <Alert severity="info">
          No test cases found matching your search query. Try adjusting your search terms or filters.
        </Alert>
      )}
    </Box>
  );
}

export default RerankingSearch;
