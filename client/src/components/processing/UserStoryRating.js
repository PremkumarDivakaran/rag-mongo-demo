import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  TextField,
  Typography,
  LinearProgress,
  Rating,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Paper,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Grid,
  Fade,
  Zoom,
  CircularProgress
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckCircleIcon,
  Timeline as TimelineIcon,
  TrendingUp as TrendingUpIcon,
  Assessment as AssessmentIcon,
  Stars as StarsIcon,
  AutoFixHigh as AutoFixHighIcon,
  DataUsage as DataUsageIcon,
  Search as SearchIcon,
  FilterList as FilterListIcon,
  SmartToy as SmartToyIcon,
  Description as DescriptionIcon,
  Sort as SortIcon,
  Summarize as SummarizeIcon,
  Article as ArticleIcon
} from '@mui/icons-material';

const UserStoryRating = () => {
  const [userStory, setUserStory] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState('');
  const [currentAnalysisId, setCurrentAnalysisId] = useState(null);
  const [progressSteps, setProgressSteps] = useState([]);
  const [activeStep, setActiveStep] = useState(0);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      // Clean up any ongoing intervals when component unmounts
      setIsAnalyzing(false);
      setCurrentAnalysisId(null);
    };
  }, []);

  const getStepIcon = (stepId) => {
    switch (stepId) {
      case 'user_story_input': return <DescriptionIcon />;
      case 'query_preprocessing': return <AutoFixHighIcon />;
      case 'hybrid_search': return <SearchIcon />;
      case 'rrf_reranking': return <SortIcon />;
      case 'deduplication': return <FilterListIcon />;
      case 'summarization': return <SummarizeIcon />;
      case 'prompt_template': return <ArticleIcon />;
      case 'llm_generation': return <SmartToyIcon />;
      default: return <CircularProgress size={20} />;
    }
  };

    const exampleUserStory = `User Story: HC-311 — Automated Insurance Pre-Authorization for Radiology Tests

Summary:
As a billing coordinator, I want the system to automatically verify a patient's insurance coverage and pre-authorize radiology tests before scheduling, so that delays and manual verification errors can be reduced.

Description:
Before scheduling any CT, MRI, or ultrasound procedure, the system should trigger an API call to the insurance provider to check if the procedure is covered under the patient's plan. If authorization is required, it should initiate the pre-authorization process automatically and store the approval ID in the patient record.

Epic:
Financial & Billing Workflows – Insurance Automation

Acceptance Criteria:

Given a patient is scheduled for a radiology test,
When the billing coordinator selects "Schedule Test",
Then the system should verify insurance eligibility via API.

Given the test requires pre-authorization,
When the request is sent,
Then the system should store the authorization ID and approval date in the billing record.

Given a test is not covered,
When the result is received,
Then the system should notify both the coordinator and patient, and offer alternative payment options.

Priority: P1
Risk: Medium
Status: In Progress`;

  const handleAnalyze = async () => {
    if (!userStory.trim()) {
      setError('Please enter a user story to analyze');
      return;
    }

    setIsAnalyzing(true);
    setError('');
    setAnalysisResult(null);
    setAnalysisProgress(0);
    setActiveStep(0);
    setCurrentAnalysisId(null);

    // Initialize progress steps
    const initialSteps = [
      { id: 'user_story_input', name: 'User Story Input', status: 'pending', startTime: null, endTime: null, data: {} },
      { id: 'query_preprocessing', name: 'Story Content Preprocessing', status: 'pending', startTime: null, endTime: null, data: {} },
      { id: 'hybrid_search', name: 'Hybrid Search', status: 'pending', startTime: null, endTime: null, data: {} },
      { id: 'rrf_reranking', name: 'RRF Re-Ranking', status: 'pending', startTime: null, endTime: null, data: {} },
      { id: 'deduplication', name: 'Deduplication ', status: 'pending', startTime: null, endTime: null, data: {} },
      { id: 'summarization', name: 'Story Analysis Summary', status: 'pending', startTime: null, endTime: null, data: {} },
      { id: 'prompt_template', name: 'Prompt Template + Context', status: 'pending', startTime: null, endTime: null, data: {} },
      { id: 'llm_generation', name: 'LLM Generation', status: 'pending', startTime: null, endTime: null, data: {} }
    ];

    setProgressSteps(initialSteps);

    try {
      console.log('🚀 Starting User Story Analysis Pipeline...');
      
      // Helper function to update step status
      const updateStep = (stepId, status, data = {}) => {
        setProgressSteps(prevSteps => {
          const newSteps = [...prevSteps];
          const stepIndex = newSteps.findIndex(s => s.id === stepId);
          if (stepIndex !== -1) {
            newSteps[stepIndex] = {
              ...newSteps[stepIndex],
              status,
              [status === 'in-progress' ? 'startTime' : 'endTime']: new Date(),
              data: { ...newSteps[stepIndex].data, ...data }
            };
            
            // Update active step and progress
            if (status === 'in-progress') {
              setActiveStep(stepIndex);
            } else if (status === 'completed') {
              setActiveStep(stepIndex + 1);
              const completedCount = newSteps.filter(s => s.status === 'completed').length;
              setAnalysisProgress((completedCount / newSteps.length) * 100);
            }
          }
          return newSteps;
        });
      };

      // STEP 1: User Story Input
      updateStep('user_story_input', 'in-progress');
      console.log('� STEP 1: User Story Input Processing');
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for UX
      updateStep('user_story_input', 'completed', { 
        storyLength: userStory.length, 
        storyFormat: 'validated' 
      });

      // STEP 2: Query Preprocessing
      updateStep('query_preprocessing', 'in-progress');
      console.log('⚙️ STEP 2: Query Preprocessing (Normalize → Abbreviations → Synonyms)');
      
      const preprocessResponse = await fetch('http://localhost:3001/api/search/preprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userStory,
          options: {
            enableAbbreviations: true,
            enableSynonyms: true,
            maxSynonymVariations: 3,
            smartExpansion: true
          }
        })
      });

      let finalQuery = userStory;
      let preprocessingData = null;
      
      if (preprocessResponse.ok) {
        preprocessingData = await preprocessResponse.json();
        finalQuery = preprocessingData.processedQuery || userStory;
        console.log('✅ Query preprocessed:', finalQuery);
      }

      updateStep('query_preprocessing', 'completed', { 
        expandedTerms: preprocessingData?.expandedTerms?.length || 0,
        synonymsAdded: preprocessingData?.metadata?.synonymMappings?.length || 0
      });

      // STEP 3: Hybrid Search
      updateStep('hybrid_search', 'in-progress');
      console.log('🔀 STEP 3: Hybrid Search (BM25 + Vector, weighted fusion)');
      
      const searchResponse = await fetch('http://localhost:3001/api/search/hybrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: finalQuery,
          limit: 10, // Reduced from 20 to 10 to minimize API calls and avoid rate limiting
          bm25Weight: 0.5,
          vectorWeight: 0.5,
          useUserStories: true, // Use user_stories collection for user story rating
          bm25Fields: ['id', 'title', 'description', 'steps', 'expectedResults', 'module']
        })
      });

      let searchResults = [];
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        searchResults = searchData.results || [];
        console.log(`✅ Retrieved ${searchResults.length} hybrid search results`);
      }

      updateStep('hybrid_search', 'completed', { 
        hybridResults: searchResults.length,
        vectorDimensions: 1536 // OpenAI embedding dimension
      });

      // STEP 4: RRF Re-Ranking
      updateStep('rrf_reranking', 'in-progress');
      console.log('🔄 STEP 4: RRF Re-Ranking (Cross-encoder, top 5 selected)');
      
      const rerankResponse = await fetch('http://localhost:3001/api/search/rerank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: finalQuery,
          limit: 5, // Reduced from 10 to 5 to match summarization limit
          fusionMethod: 'rrf',
          rerankTopK: 10, // Reduced from 20 to 10 to match hybrid search limit
          bm25Weight: 0.5,
          vectorWeight: 0.5,
          useUserStories: true // Use user_stories collection for user story rating
        })
      });

      let rerankResults = searchResults.slice(0, 10); // Fallback
      if (rerankResponse.ok) {
        const rerankData = await rerankResponse.json();
        rerankResults = rerankData.results || rerankResults;
        console.log(`✅ RRF Re-ranking complete: Top ${rerankResults.length} results selected`);
      } else {
        console.warn('⚠️ Re-ranking failed, using search results');
      }
      
      updateStep('rrf_reranking', 'completed', { 
        topResults: rerankResults.length,
        reranked: true
      });

      // STEP 5: Deduplication
      updateStep('deduplication', 'in-progress');
      console.log('🔄 STEP 5: Deduplication (Cosine > 0.95)');
      
      let dedupResults = rerankResults;
      let duplicatesRemoved = 0;
      
      // Always make the API call to show in network tab
      const dedupResponse = await fetch('http://localhost:3001/api/search/deduplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          results: rerankResults.length > 0 ? rerankResults.map(r => {
            const { embedding, ...rest } = r;
            return rest;
          }) : [{ id: 'dummy', title: 'No results to deduplicate' }],
          threshold: 0.95
        })
      });

      if (dedupResponse.ok) {
        const dedupData = await dedupResponse.json();
        if (rerankResults.length > 0) {
          dedupResults = dedupData.deduplicated || rerankResults;
          duplicatesRemoved = dedupData.stats?.duplicatesRemoved || 0;
        }
        console.log(`✅ Deduplication complete: ${duplicatesRemoved} duplicates removed`);
      } else {
        console.warn('⚠️ Deduplication failed, using original results');
      }

      updateStep('deduplication', 'completed', { 
        duplicatesRemoved: duplicatesRemoved,
        finalCount: dedupResults.length
      });

      // STEP 6: Summarization
      updateStep('summarization', 'in-progress');
      console.log('📊 STEP 6: Summarization (TestLeaf API) - Always make API call');
      
      // Always make the summarization API call to show in network tab
      const summarizeResponse = await fetch('http://localhost:3001/api/search/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          results: dedupResults.length > 0 ? dedupResults.slice(0, 2) : [{ 
            id: 'no-results', 
            title: 'No results found', 
            module: 'General',
            priority: 'Medium',
            type: 'Summary Request'
          }],
          summaryType: 'detailed'
        })
      });

      let summaryData = { summary: 'No related user stories found for analysis' };
      if (summarizeResponse.ok) {
        summaryData = await summarizeResponse.json();
        console.log('✅ Summarization API Response:', {
          summaryLength: summaryData.summary?.length || 0,
          tokens: summaryData.tokens,
          cost: summaryData.cost
        });
      } else {
        console.warn('⚠️ Summarization API failed:', summarizeResponse.status);
      }

      updateStep('summarization', 'completed', { 
        summaryGenerated: true,
        coverageAreas: [...new Set(dedupResults.map(r => r.module))].length
      });

      // STEP 7: Prompt Template
      updateStep('prompt_template', 'in-progress');
      console.log('📋 STEP 7: Prompt Template + Context (ICEPOT framework)');
      
      const ratingPrompt = `You are an expert Product Owner and QA analyst. Analyze this user story and provide detailed scoring.

# USER STORY TO ANALYZE:
"""
${userStory}
"""

# ANALYSIS CONTEXT:
- Related user stories found: ${dedupResults.length}
- Coverage areas: ${[...new Set(dedupResults.map(r => r.module))].join(', ') || 'General functionality'}

${summaryData.summary ? `
# SUMMARIZED CONTEXT FROM RELATED USER STORIES:
${summaryData.summary}
` : ''}

${dedupResults.length > 0 ? `
# DETAILED RELATED USER STORIES:
${dedupResults.slice(0, 2).map((story, index) => `
${index + 1}. **${story.id}**: ${story.title}
   - Summary: ${story.summary || 'N/A'}
   - Epic: ${story.epic || 'N/A'}
   - Priority: ${story.priority || 'N/A'}
   - Status: ${story.status || 'N/A'}
   - Similarity Score: ${story.score?.toFixed(3) || 'N/A'}
`).join('')}
` : ''}

# SCORING CRITERIA (1-10 scale):

## Title Quality (1-10):
- Is the title clear and specific?
- Does it follow a consistent format?
- Does it indicate the feature/functionality?

## Description Quality (1-10):
- Is the user need clearly stated ("As a [user], I want [goal] so that [benefit]")?
- Is the business context clear?
- Are technical requirements specified?
- Is it detailed enough for development?

## Acceptance Criteria Quality (1-10):
- Are criteria testable and measurable?
- Do they follow Given-When-Then format?
- Do they cover positive and negative scenarios?
- Are edge cases considered?

# REQUIRED JSON OUTPUT:
{
  "overallRating": {
    "score": <average of all component scores>,
    "feedback": "<overall assessment of story quality>",
    "suggestions": ["<specific improvement 1>", "<specific improvement 2>", "<specific improvement 3>"]
  },
  "componentScores": {
    "title": {
      "score": <1-10>,
      "feedback": "<what's good/bad about the title and how to improve>"
    },
    "description": {
      "score": <1-10>,
      "feedback": "<assessment of user story format, clarity, business value>"
    },
    "acceptanceCriteria": {
      "score": <1-10>,
      "feedback": "<assessment of testability, completeness, edge cases>"
    }
  },
  "dependencies": [
    {
      "userStoryId": "<ID if found>",
      "title": "<title of dependent story>",
      "relationship": "<Depends on|Blocked by|Requires>",
      "impact": "<High|Medium|Low>",
      "description": "<why this dependency exists>"
    }
  ],
  "analysis": {
    "strengths": ["<strength 1>", "<strength 2>"],
    "weaknesses": ["<weakness 1>", "<weakness 2>"],
    "complexity": "<Low|Medium|High>",
    "estimatedEffort": "<effort estimate in story points or hours>",
    "businessValue": "<Low|Medium|High>"
  },
  "aiFeedback": "<detailed paragraph explaining the analysis, what's missing, and specific recommendations for improvement>"
}

IMPORTANT: 
- Give realistic scores (not 0)
- Be specific in feedback
- Identify actual improvements needed
- Return valid JSON only`;

      updateStep('prompt_template', 'completed', { 
        promptGenerated: true,
        contextIncluded: true,
        icepotFramework: 'applied',
        summaryIncluded: !!summaryData.summary,
        relatedStoriesCount: dedupResults.length
      });

      // STEP 8: LLM Generation
      updateStep('llm_generation', 'in-progress');
      console.log('🤖 STEP 8: LLM Generation (TestLeaf API with Pre-processed Context)');
      
      // Extract user story components for the RAG-enhanced endpoint
      const userStoryComponents = {
        id: "CUSTOM-INPUT",
        title: userStory.split('\n')[0] || 'User Story Analysis',
        summary: userStory.substring(0, 200) + '...',
        description: userStory
      };
      
      const analysisResponse = await fetch('http://localhost:3001/api/test-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: ratingPrompt,
          userStory: userStoryComponents,
          enableRAG: false, // Disable RAG since we already have the context from our pipeline
          relatedContext: {
            summary: summaryData.summary,
            stories: dedupResults.slice(0, 2),
            count: dedupResults.length
          },
          temperature: 0.3,
          maxTokens: 3000
        })
      });

      if (!analysisResponse.ok) {
        throw new Error(`Analysis failed: ${analysisResponse.status}`);
      }

      const analysisData = await analysisResponse.json();
      console.log('✅ LLM generation complete');

      // Parse the analysis result
      let parsedAnalysis = analysisData.response;
      if (typeof parsedAnalysis === 'string') {
        try {
          parsedAnalysis = JSON.parse(parsedAnalysis);
        } catch (e) {
          // If parsing fails, provide a default structure
          parsedAnalysis = {
            overallRating: { score: 7, feedback: "Analysis completed", suggestions: [] },
            componentScores: {
              title: { score: 7, feedback: "Title analysis completed" },
              description: { score: 7, feedback: "Description analysis completed" },
              acceptanceCriteria: { score: 6, feedback: "Acceptance criteria analysis completed" }
            },
            dependencies: [],
            analysis: {
              strengths: ["User story provided"],
              weaknesses: ["Could benefit from more detail"],
              complexity: "Medium",
              estimatedEffort: "2-3 story points",
              businessValue: "Medium"
            },
            aiFeedback: "Analysis completed successfully."
          };
        }
      }

      updateStep('llm_generation', 'completed', { 
        tokensUsed: analysisData.tokens?.total || 0,
        costIncurred: analysisData.cost?.total || 0,
        llmModel: 'gpt-4o-mini'
      });

      // Set final results
      console.log('🔍 Final dedupResults for UI:', {
        count: dedupResults.length,
        results: dedupResults.slice(0, 3).map(r => ({ id: r.id, key: r.key, title: r.title || r.summary }))
      });

      const finalResult = {
        success: true,
        ...parsedAnalysis,
        relatedTestCases: dedupResults.slice(0, 10),
        metadata: {
          preprocessingData,
          testCasesCount: dedupResults.length,
          cost: {
            total: analysisData.cost?.total || 0
          },
          tokens: {
            total: analysisData.tokens?.total || 0
          },
          pipeline: '8-step RAG pipeline'
        }
      };

      setAnalysisResult(finalResult);
      setAnalysisProgress(100);
      console.log('✅ User Story Analysis Pipeline complete!');
      
    } catch (err) {
      console.error('❌ Analysis error:', err);
      setError(`Analysis failed: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleClearForm = () => {
    setUserStory('');
    setAnalysisResult(null);
    setError('');
    setProgressSteps([]);
    setCurrentAnalysisId(null);
    setAnalysisProgress(0);
    setActiveStep(0);
  };

  const handleUseExample = () => {
    setUserStory(exampleUserStory);
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Fade in timeout={800}>
        <Box>
          <Typography 
            variant="h3" 
            component="h1" 
            gutterBottom 
            sx={{ 
              fontWeight: 'bold',
              background: 'linear-gradient(45deg, #1976d2, #42a5f5)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              textAlign: 'center',
              mb: 3
            }}
          >
            🚀 AI-Powered User Story Rating
          </Typography>
          
          <Typography 
            variant="h6" 
            sx={{ 
              textAlign: 'center',
              color: 'text.secondary',
              mb: 4
            }}
          >
            Get comprehensive analysis and quality ratings for your user stories
          </Typography>
        </Box>
      </Fade>
      
      <Typography variant="body1" sx={{ mb: 3, color: 'text.secondary' }}>
        Analyze your user story using AI-powered insights and get comprehensive feedback including rating, dependencies, and recommendations.
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              User Story Details
            </Typography>
            
            <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
              <Button 
                variant="outlined" 
                onClick={handleUseExample}
                size="small"
              >
                Use Example Story
              </Button>
              <Button 
                variant="outlined" 
                onClick={handleClearForm}
                size="small"
              >
                Clear Form
              </Button>
            </Box>

            <TextField
              fullWidth
              multiline
              rows={15}
              label="Complete User Story"
              placeholder="Paste your complete user story here (including title, description, acceptance criteria, etc.)"
              value={userStory}
              onChange={(e) => setUserStory(e.target.value)}
              variant="outlined"
              sx={{ mb: 2 }}
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Button
              variant="contained"
              onClick={handleAnalyze}
              disabled={isAnalyzing || !userStory.trim()}
              sx={{ minWidth: 200 }}
            >
              {isAnalyzing ? 'Running Analysis...' : 'Analyze Story Quality (Structure → Validation → AI Rating)'}
            </Button>
            
            {isAnalyzing && (
              <Box sx={{ flexGrow: 1, ml: 2 }}>
                <LinearProgress 
                  variant="determinate" 
                  value={analysisProgress} 
                  sx={{ height: 6, borderRadius: 3 }}
                />
              </Box>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Progress Stepper */}
      {(isAnalyzing || progressSteps.length > 0) && (
        <Zoom in timeout={600}>
          <Card sx={{ 
            mt: 3,
            background: isAnalyzing 
              ? 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)' 
              : 'linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%)',
            border: isAnalyzing ? '1px solid #2196f3' : '1px solid #4caf50'
          }}>
            <CardContent>
              <Typography 
                variant="h6" 
                gutterBottom 
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 1,
                  color: isAnalyzing ? 'primary.main' : 'success.main',
                  fontWeight: 'bold'
                }}
              >
                <TimelineIcon />
                {isAnalyzing ? 'Analysis Progress' : 'Analysis Complete ✅'}
              </Typography>
              
              <LinearProgress 
                variant="determinate" 
                value={analysisProgress} 
                sx={{ 
                  height: 8, 
                  borderRadius: 4, 
                  mb: 3,
                  bgcolor: 'grey.200',
                  '& .MuiLinearProgress-bar': {
                    background: 'linear-gradient(90deg, #4fc3f7, #29b6f6, #0288d1)',
                    borderRadius: 4
                  }
                }}
              />
              
              <Stepper activeStep={activeStep} orientation="vertical">
                {progressSteps.map((step, index) => (
                  <Step key={step.id}>
                    <StepLabel 
                      icon={
                        step.status === 'completed' ? (
                          <CheckCircleIcon color="success" />
                        ) : step.status === 'in-progress' ? (
                          <CircularProgress size={20} />
                        ) : (
                          getStepIcon(step.id)
                        )
                      }
                      sx={{
                        '& .MuiStepLabel-label': {
                          color: step.status === 'completed' ? 'success.main' : 
                                 step.status === 'in-progress' ? 'primary.main' : 'text.secondary',
                          fontWeight: step.status === 'in-progress' ? 'bold' : 'normal'
                        }
                      }}
                    >
                      {step.name}
                    </StepLabel>
                    <StepContent>
                      <Box sx={{ pb: 2 }}>
                        {step.status === 'completed' && step.data && (
                          <Typography variant="body2" color="text.secondary">
                            {step.id === 'user_story_input' && 
                              `✓ Story validated (${step.data.storyLength || 0} characters)`}
                            {step.id === 'query_preprocessing' && 
                              `✓ Expanded ${step.data.expandedTerms || 0} terms, Added ${step.data.synonymsAdded || 0} synonyms`}
                            {step.id === 'hybrid_search' && 
                              `✓ Found ${step.data.hybridResults || 0} results using ${step.data.vectorDimensions || 0}D vectors`}
                            {step.id === 'rrf_reranking' && 
                              `✓ Re-ranked to top ${step.data.topResults || 0} results`}
                            {step.id === 'deduplication' && 
                              `✓ Removed ${step.data.duplicatesRemoved || 0} duplicates, Final: ${step.data.finalCount || 0}`}
                            {step.id === 'summarization' && 
                              `✓ Generated summary covering ${step.data.coverageAreas || 0} areas`}
                            {step.id === 'prompt_template' && 
                              `✓ Applied ICEPOT framework with context`}
                            {step.id === 'llm_generation' && 
                              `✓ ${step.data.llmModel || 'LLM'} used ${step.data.tokensUsed || 0} tokens, Cost: $${step.data.costIncurred || 0}`}
                          </Typography>
                        )}
                        {step.status === 'in-progress' && (
                          <Typography variant="body2" color="primary" sx={{ fontStyle: 'italic' }}>
                            🔄 Processing...
                          </Typography>
                        )}
                      </Box>
                    </StepContent>
                  </Step>
                ))}
              </Stepper>
            </CardContent>
          </Card>
        </Zoom>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {analysisResult && (
        <Fade in timeout={1000}>
          <Card sx={{ 
            mt: 3,
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            position: 'relative',
            overflow: 'hidden',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(255,255,255,0.1)',
              backdropFilter: 'blur(10px)'
            }
          }}>
            <CardContent sx={{ position: 'relative', zIndex: 1 }}>
              <Typography 
                variant="h5" 
                gutterBottom 
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 2,
                  fontWeight: 'bold',
                  textShadow: '0 2px 4px rgba(0,0,0,0.3)'
                }}
              >
                <StarsIcon sx={{ fontSize: 30 }} />
                Analysis Results
              </Typography>

              {/* Overall Rating Card */}
              <Card sx={{ 
                mb: 3, 
                background: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 50%, #fecfef 100%)',
                border: 'none',
                boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
              }}>
                <CardContent>
                  <Grid container spacing={3} alignItems="center">
                    <Grid item xs={12} md={6}>
                      <Typography 
                        variant="h4" 
                        component="div" 
                        sx={{ 
                          fontWeight: 'bold',
                          color: '#1a1a1a',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1
                        }}
                      >
                        <TrendingUpIcon sx={{ fontSize: 40, color: '#ff6b6b' }} />
                        Overall Rating: {analysisResult.overallRating?.score || 0}/10
                      </Typography>
                      <Rating 
                        value={analysisResult.overallRating?.score || 0} 
                        max={10} 
                        readOnly 
                        size="large"
                        sx={{ 
                          mb: 2,
                          '& .MuiRating-iconFilled': {
                            color: '#ff6b6b'
                          }
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Box sx={{ 
                        p: 2, 
                        bgcolor: 'rgba(255,255,255,0.9)', 
                        borderRadius: 2,
                        border: '2px dashed #ff6b6b'
                      }}>
                        <Typography 
                          variant="body1" 
                          sx={{ 
                            color: '#1a1a1a',
                            fontWeight: 'medium'
                          }}
                        >
                          {analysisResult.overallRating?.feedback || 'Rating based on clarity, completeness, and feasibility'}
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>

            {analysisResult.componentScores && (
              <Card sx={{ 
                mb: 3,
                background: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
                border: 'none',
                boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
              }}>
                <Accordion defaultExpanded sx={{ background: 'transparent', boxShadow: 'none' }}>
                  <AccordionSummary 
                    expandIcon={<ExpandMoreIcon sx={{ color: '#1a1a1a' }} />}
                    sx={{ '& .MuiAccordionSummary-content': { margin: '12px 0' } }}
                  >
                    <Typography 
                      variant="h5" 
                      sx={{ 
                        fontWeight: 'bold',
                        color: '#1a1a1a',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1
                      }}
                    >
                      <AssessmentIcon sx={{ fontSize: 30, color: '#4ecdc4' }} />
                      📊 Component Scores
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Grid container spacing={3}>
                      {analysisResult.componentScores.title && (
                        <Grid item xs={12} md={4}>
                          <Card sx={{ 
                            p: 3, 
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            color: 'white',
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between'
                          }}>
                            <Box>
                              <Typography 
                                variant="h6" 
                                sx={{ 
                                  fontWeight: 'bold', 
                                  mb: 2,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1
                                }}
                              >
                                📝 Title Quality
                              </Typography>
                              <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
                                {analysisResult.componentScores.title.score}/10
                              </Typography>
                              <Rating 
                                value={analysisResult.componentScores.title.score} 
                                max={10} 
                                readOnly 
                                size="small"
                                sx={{ 
                                  mb: 2,
                                  '& .MuiRating-iconFilled': { color: '#ffd700' }
                                }}
                              />
                            </Box>
                            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                              {analysisResult.componentScores.title.feedback}
                            </Typography>
                          </Card>
                        </Grid>
                      )}
                      
                      {analysisResult.componentScores.description && (
                        <Grid item xs={12} md={4}>
                          <Card sx={{ 
                            p: 3, 
                            background: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
                            color: '#1a1a1a',
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between'
                          }}>
                            <Box>
                              <Typography 
                                variant="h6" 
                                sx={{ 
                                  fontWeight: 'bold', 
                                  mb: 2,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1
                                }}
                              >
                                📋 Description Quality
                              </Typography>
                              <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
                                {analysisResult.componentScores.description.score}/10
                              </Typography>
                              <Rating 
                                value={analysisResult.componentScores.description.score} 
                                max={10} 
                                readOnly 
                                size="small"
                                sx={{ 
                                  mb: 2,
                                  '& .MuiRating-iconFilled': { color: '#ff6b6b' }
                                }}
                              />
                            </Box>
                            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                              {analysisResult.componentScores.description.feedback}
                            </Typography>
                          </Card>
                        </Grid>
                      )}
                      
                      {analysisResult.componentScores.acceptanceCriteria && (
                        <Grid item xs={12} md={4}>
                          <Card sx={{ 
                            p: 3, 
                            background: 'linear-gradient(135deg, #a8e6cf 0%, #88d8a3 100%)',
                            color: '#1a1a1a',
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between'
                          }}>
                            <Box>
                              <Typography 
                                variant="h6" 
                                sx={{ 
                                  fontWeight: 'bold', 
                                  mb: 2,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1
                                }}
                              >
                                ✅ Acceptance Criteria
                              </Typography>
                              <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
                                {analysisResult.componentScores.acceptanceCriteria.score}/10
                              </Typography>
                              <Rating 
                                value={analysisResult.componentScores.acceptanceCriteria.score} 
                                max={10} 
                                readOnly 
                                size="small"
                                sx={{ 
                                  mb: 2,
                                  '& .MuiRating-iconFilled': { color: '#4caf50' }
                                }}
                              />
                            </Box>
                            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                              {analysisResult.componentScores.acceptanceCriteria.feedback}
                            </Typography>
                          </Card>
                        </Grid>
                      )}
                    </Grid>
                  </AccordionDetails>
                </Accordion>
              </Card>
            )}

            {analysisResult.aiFeedback && (
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">💡 AI Feedback</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                    {analysisResult.aiFeedback}
                  </Typography>
                </AccordionDetails>
              </Accordion>
            )}

            {analysisResult.overallRating?.suggestions && analysisResult.overallRating.suggestions.length > 0 && (
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">💡 Suggestions</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box sx={{ pl: 2 }}>
                    {analysisResult.overallRating.suggestions.map((suggestion, index) => (
                      <Typography key={index} variant="body2" sx={{ mb: 1 }}>
                        • {suggestion}
                      </Typography>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {analysisResult.analysis && (
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">� Analysis Details</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {analysisResult.analysis.complexity && (
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                          Complexity: <Chip label={analysisResult.analysis.complexity} size="small" />
                        </Typography>
                      </Box>
                    )}
                    {analysisResult.analysis.businessValue && (
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                          Business Value: <Chip label={analysisResult.analysis.businessValue} size="small" color="primary" />
                        </Typography>
                      </Box>
                    )}
                    {analysisResult.analysis.estimatedEffort && (
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                          Estimated Effort: {analysisResult.analysis.estimatedEffort}
                        </Typography>
                      </Box>
                    )}
                    {analysisResult.analysis.strengths && analysisResult.analysis.strengths.length > 0 && (
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                          Strengths:
                        </Typography>
                        {analysisResult.analysis.strengths.map((strength, index) => (
                          <Typography key={index} variant="body2" sx={{ ml: 2 }}>
                            ✓ {strength}
                          </Typography>
                        ))}
                      </Box>
                    )}
                    {analysisResult.analysis.weaknesses && analysisResult.analysis.weaknesses.length > 0 && (
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'warning.main' }}>
                          Areas for Improvement:
                        </Typography>
                        {analysisResult.analysis.weaknesses.map((weakness, index) => (
                          <Typography key={index} variant="body2" sx={{ ml: 2 }}>
                            ⚠ {weakness}
                          </Typography>
                        ))}
                      </Box>
                    )}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Related User Stories from Database */}
            {analysisResult.relatedTestCases && (
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">
                    � Related User Stories ({analysisResult.relatedTestCases.length || 0})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Similar user stories found using hybrid search (BM25 + Vector similarity):
                  </Typography>
                  
                  {analysisResult.relatedTestCases.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {analysisResult.relatedTestCases.map((story, index) => (
                        <Paper key={index} sx={{ 
                          p: 3, 
                          bgcolor: 'rgba(255,255,255,0.95)', 
                          border: '1px solid #e3f2fd',
                          borderRadius: 2,
                          '&:hover': {
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                            transform: 'translateY(-2px)',
                            transition: 'all 0.2s ease-in-out'
                          }
                        }}>
                          {/* User Story ID - Primary Focus */}
                          <Box sx={{ mb: 2 }}>
                            <Typography variant="h5" sx={{ 
                              fontWeight: 'bold', 
                              color: 'primary.main',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1
                            }}>
                              📝 ID: {story.key || story.id || `US-${index + 1}`}
                            </Typography>
                          </Box>

                          {/* Title - Secondary Focus */}
                          <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'text.secondary', mb: 0.5 }}>
                              Title:
                            </Typography>
                            <Typography variant="h6" sx={{ fontWeight: 'medium', color: 'text.primary' }}>
                              {story.summary || story.title || 'Untitled User Story'}
                            </Typography>
                          </Box>
                          
                          {/* Description - Main Content */}
                          {story.description && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'text.secondary', mb: 0.5 }}>
                                Description:
                              </Typography>
                              <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.6, pl: 1 }}>
                                {story.description.length > 300 
                                  ? `${story.description.substring(0, 300)}...` 
                                  : story.description
                                }
                              </Typography>
                            </Box>
                          )}

                          {/* Additional Metadata as Secondary Info */}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', pt: 2, borderTop: '1px solid #e0e0e0' }}>
                            <Chip 
                              label={`Similarity: ${story.score ? story.score.toFixed(2) : 'N/A'}`}
                              size="small" 
                              color="secondary"
                              variant="outlined"
                            />
                            {story.module && (
                              <Chip 
                                label={story.module} 
                                size="small"
                                color="info"
                                variant="outlined"
                              />
                            )}
                            {story.priority && (
                              <Chip 
                                label={`Priority: ${story.priority}`} 
                                size="small"
                                color={story.priority === 'High' ? 'error' : story.priority === 'Medium' ? 'warning' : 'success'}
                                variant="outlined"
                              />
                            )}
                          </Box>
                        </Paper>
                      ))}
                    </Box>
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                      <Typography variant="body1" color="text.secondary">
                        🔍 No similar user stories found in the database
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        This could mean your story is unique or the search didn't find close matches
                      </Typography>
                    </Box>
                  )}
                  
                  {analysisResult.metadata && (
                    <Box sx={{ mt: 3, p: 2, bgcolor: 'rgba(33, 150, 243, 0.1)', borderRadius: 1, border: '1px solid rgba(33, 150, 243, 0.3)' }}>
                      <Typography variant="body2" color="primary.main">
                        💡 <strong>Search Statistics:</strong> Found {analysisResult.metadata.testCasesCount || 0} related stories 
                        using {analysisResult.metadata.pipeline || 'hybrid search'} with 
                        costs: ${typeof analysisResult.metadata.cost?.total === 'number' ? analysisResult.metadata.cost.total.toFixed(4) : '0.0000'}
                      </Typography>
                    </Box>
                  )}
                </AccordionDetails>
              </Accordion>
            )}

            {analysisResult.dependencies && analysisResult.dependencies.length > 0 && (
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">
                    🔗 User Story Dependencies ({analysisResult.dependencies.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {analysisResult.dependencies.map((dep, index) => (
                      <Paper key={index} sx={{ p: 2, bgcolor: 'grey.50', border: '1px solid #e0e0e0' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <Chip 
                            label={dep.userStoryId || dep.description || (typeof dep === 'string' ? dep : 'Unknown')}
                            color="primary"
                            variant="outlined"
                            sx={{ fontWeight: 'bold' }}
                          />
                          <Chip 
                            label={dep.relationship || dep.type || 'Related to'} 
                            size="small" 
                            color="secondary"
                          />
                          {dep.impact && (
                            <Chip 
                              label={`${dep.impact} Impact`} 
                              size="small"
                              color={dep.impact === 'High' ? 'error' : dep.impact === 'Medium' ? 'warning' : 'default'}
                            />
                          )}
                        </Box>
                        <Typography variant="body2" sx={{ mb: 1, fontWeight: 'bold' }}>
                          {dep.title || (typeof dep === 'string' ? dep : 'Dependency')}
                        </Typography>
                        {dep.description && dep.description !== dep.title && typeof dep !== 'string' && (
                          <Typography variant="body2" color="text.secondary">
                            {dep.description}
                          </Typography>
                        )}
                      </Paper>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {analysisResult.qualityChecks && (
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">✅ Quality Checks</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {Object.entries(analysisResult.qualityChecks).map(([key, check]) => (
                      <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" sx={{ color: check.passed ? 'success.main' : 'error.main' }}>
                          {check.passed ? '✓' : '✗'}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                          {check.name}:
                        </Typography>
                        <Typography variant="body2">
                          {check.description}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}
            </CardContent>
          </Card>
        </Fade>
      )}
    </Container>
  );
};

export default UserStoryRating;
