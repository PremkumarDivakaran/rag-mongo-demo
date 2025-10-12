import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { MongoClient } from 'mongodb';
import dns from 'dns';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// Fix DNS resolution issue on macOS
dns.setServers(['8.8.8.8', '8.8.4.4']);

// Testleaf API configuration
const TESTLEAF_API_BASE = process.env.TESTLEAF_API_BASE || 'https://api.testleaf.com/ai';
const USER_EMAIL = process.env.USER_EMAIL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
// Increase payload limit to handle large embeddings (default is 100kb)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// ======================== Job Tracking ========================
// In-memory job tracking (consider using Redis for production)
const jobs = new Map();

function createJob(files) {
  const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  jobs.set(jobId, {
    id: jobId,
    files,
    status: 'in-progress',
    progress: 0,
    total: files.length,
    results: [],
    startTime: new Date(),
    currentFile: null
  });
  return jobId;
}

function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (job) {
    Object.assign(job, updates);
    jobs.set(jobId, job);
  }
}

function getJob(jobId) {
  return jobs.get(jobId);
}

// Clean up old jobs (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [jobId, job] of jobs.entries()) {
    if (new Date(job.startTime).getTime() < oneHourAgo) {
      jobs.delete(jobId);
    }
  }
}, 10 * 60 * 1000); // Run every 10 minutes

// ======================== Validation Helpers ========================

async function validateDbCollectionIndex(client, dbName, collectionName, indexName, requireDocuments = false) {
  try {
    // Attempt to detect database existence via listDatabases (may require privileges)
    let dbExists = false;
    try {
      const admin = client.db().admin();
      const dbs = await admin.listDatabases();
      dbExists = dbs.databases.some(d => d.name === dbName);
    } catch (err) {
      // If listDatabases fails because of permissions, fallback to checking the collection directly
      console.warn('⚠️ listDatabases failed (permissions?), falling back to listCollections check:', err.message);
      dbExists = true; // assume DB exists and proceed to collection check
    }

    if (!dbExists) {
      return { ok: false, error: `Database '${dbName}' not found` };
    }

    const db = client.db(dbName);
    const collections = await db.listCollections({ name: collectionName }).toArray();
    if (!collections || collections.length === 0) {
      return { ok: false, error: `Collection '${collectionName}' not found in database '${dbName}'` };
    }

    if (requireDocuments) {
      const count = await db.collection(collectionName).countDocuments();
      if (count === 0) {
        return { ok: false, error: `No documents found in collection '${collectionName}'. Please create embeddings first.` };
      }
    }

    // Verify Atlas Search indexes (listSearchIndexes command)
    if (indexName) {
      try {
        const collection = db.collection(collectionName);
        const indexes = await collection.listSearchIndexes().toArray();
        if (!indexes || !Array.isArray(indexes)) {
          return { ok: false, error: `Unable to verify search indexes for collection '${collectionName}'.` };
        }
        const found = indexes.some(idx => idx.name === indexName);
        if (!found) {
          return { ok: false, error: `Search index '${indexName}' not found for collection '${collectionName}'` };
        }
      } catch (err) {
        // Some server versions / permissions may not allow listSearchIndexes; surface helpful message
        return { ok: false, error: `Could not verify search index '${indexName}': ${err.message}` };
      }
    }

    return { ok: true };

  } catch (err) {
    return { ok: false, error: `Validation failed: ${err.message}` };
  }
}

// ======================== API Routes ========================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Get active jobs
app.get('/api/jobs/active', (req, res) => {
  const activeJobs = Array.from(jobs.values()).filter(job => job.status === 'in-progress');
  res.json({ jobs: activeJobs });
});

// Get job status
app.get('/api/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// Get distinct metadata values for filters
app.get('/api/metadata/distinct', async (req, res) => {
  try {
    console.log('🔍 Fetching distinct metadata values...');
    console.log('📊 DB Name:', process.env.DB_NAME);
    console.log('📊 Collection Name:', process.env.COLLECTION_NAME);
    
    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    await mongoClient.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    // Check document count first
    const count = await collection.countDocuments();
    console.log(`📊 Total documents in collection: ${count}`);

    if (count === 0) {
      console.log('⚠️ Collection is empty! No documents found.');
      await mongoClient.close();
      return res.json({
        success: true,
        metadata: {
          modules: [],
          priorities: [],
          risks: [],
          types: []
        },
        message: 'Collection is empty. Please create embeddings first.'
      });
    }

    // Get a sample document to see what fields exist
    const sampleDoc = await collection.findOne({});
    console.log('📄 Sample document fields:', Object.keys(sampleDoc || {}));
    console.log('📄 Sample document:', JSON.stringify(sampleDoc, null, 2));

    const modules = await collection.distinct('module');
    const priorities = await collection.distinct('priority');
    const risks = await collection.distinct('risk');
    const types = await collection.distinct('automationManual');

    console.log(`✅ Found ${modules.length} modules:`, modules);
    console.log(`✅ Found ${priorities.length} priorities:`, priorities);
    console.log(`✅ Found ${risks.length} risks:`, risks);
    console.log(`✅ Found ${types.length} types:`, types);

  await mongoClient.close();

    const metadata = {
      modules: modules.filter(Boolean).sort(),
      priorities: priorities.filter(Boolean).sort(),
      risks: risks.filter(Boolean).sort(),
      types: types.filter(Boolean).sort()
    };

    console.log('📤 Sending metadata:', metadata);

    res.json({
      success: true,
      metadata
    });

  } catch (error) {
    console.error('❌ Error fetching metadata:', error);
    res.status(500).json({ error: 'Failed to fetch metadata', details: error.message });
  }
});

// Get all files in data directory
app.get('/api/files', (req, res) => {
  try {
    const dataPath = path.join(__dirname, '../src/data');
    const files = fs.readdirSync(dataPath)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const filePath = path.join(dataPath, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          size: stats.size,
          modified: stats.mtime,
          type: 'json'
        };
      });
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read files', details: error.message });
  }
});

// Upload and convert Excel to JSON
app.post('/api/upload-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const inputFile = req.file.path;
    const outputPath = path.join(__dirname, '../src/data', `converted-${Date.now()}.json`);
    
    // Convert paths to forward slashes (works on both Windows and Unix)
    const inputFileNormalized = inputFile.replace(/\\/g, '/');
    const outputPathNormalized = outputPath.replace(/\\/g, '/');
    
    // Create a modified version of excel-to-json.js for this specific file
    const scriptContent = `
import xlsx from "xlsx";
import fs from "fs";

const excelFile = "${inputFileNormalized}";      
const sheetName = "${req.body.sheetName || 'Testcases'}";   
const outputFile = "${outputPathNormalized}";      

const columnMap = {
  "Module": "module",
  "Test ID": "id",
  "Pre-Requisites": "preRequisites",
  "Test Title": "title",
  "Test Case Description": "description",
  "Test Steps": "steps",
  "Expected Results": "expectedResults",
  "Automation/Manual": "automationManual",
  "Priority": "priority",
  "Created By": "createdBy",
  "Created Date": "createdDate",
  "Last modified date": "lastModifiedDate",
  "Risk": "risk",
  "Version": "version",
  "Type": "type"
};

try {
  const workbook = xlsx.readFile(excelFile);
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    console.error(\`❌ Sheet "\${sheetName}" not found in \${excelFile}\`);
    process.exit(1);
  }

  const rawData = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

  const jsonData = rawData.map((row, index) => {
    const mappedRow = {};
    for (const [excelCol, jsonKey] of Object.entries(columnMap)) {
      mappedRow[jsonKey] = row[excelCol] || "";
    }
    return mappedRow;
  });

  fs.writeFileSync(outputFile, JSON.stringify(jsonData, null, 2), "utf-8");
  console.log(\`✅ Converted \${jsonData.length} rows from "\${sheetName}" into \${outputFile}\`);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
`;

    const tempScriptPath = path.join(__dirname, `temp-excel-convert-${Date.now()}.js`);
    fs.writeFileSync(tempScriptPath, scriptContent);

    // Execute the conversion script
    const child = spawn('node', [tempScriptPath], { cwd: __dirname });
    
    let output = '';
    let error = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      error += data.toString();
    });

    child.on('close', (code) => {
      // Clean up temp script and uploaded file
      fs.unlinkSync(tempScriptPath);
      fs.unlinkSync(inputFile);

      if (code === 0) {
        res.json({
          success: true,
          message: 'File converted successfully',
          outputFile: path.basename(outputPath),
          output
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Conversion failed',
          details: error || output
        });
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Create embeddings for selected files
app.post('/api/create-embeddings', async (req, res) => {
  try {
    const { files } = req.body;
    
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files selected' });
    }

    // Validate DB and collection exist (no documents required for creating embeddings)
    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    try {
      await mongoClient.connect();
      const validation = await validateDbCollectionIndex(mongoClient, process.env.DB_NAME, process.env.COLLECTION_NAME, null, false);
      if (!validation.ok) {
        await mongoClient.close();
        return res.status(400).json({ error: validation.error });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to validate database/collection', details: err.message });
    } finally {
      try { await mongoClient.close(); } catch (e) {}
    }

    // Create a job and return immediately
    const jobId = createJob(files);
    
    // Start processing in background
    processEmbeddings(jobId, files);
    
    // Return job ID to client
    res.json({
      success: true,
      jobId,
      message: 'Embedding creation started',
      filesCount: files.length
    });

  } catch (error) {
    res.status(500).json({ error: 'Embedding creation failed', details: error.message });
  }
});

// Background processing function
async function processEmbeddings(jobId, files) {
  const results = [];

  
  for (const fileName of files) {
    updateJob(jobId, { currentFile: fileName });
    
    const filePath = path.join(__dirname, '../src/data', fileName);
    // Convert paths to forward slashes for cross-platform compatibility
    const filePathNormalized = filePath.replace(/\\/g, '/');
    
    // Create a modified version of create-embeddings-store.js for this specific file
    const scriptContent = `
import { MongoClient } from "mongodb";
import dns from "dns";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  ssl: true,
  tlsAllowInvalidCertificates: true,
  tlsAllowInvalidHostnames: true,
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
});

const TESTLEAF_API_BASE = process.env.TESTLEAF_API_BASE || 'https://api.testleaf.ai';
const USER_EMAIL = process.env.USER_EMAIL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

async function main() {
  try {
  await mongoClient.connect();
  const db = mongoClient.db(process.env.DB_NAME);
  const collection = db.collection(process.env.COLLECTION_NAME);

    const testcases = JSON.parse(fs.readFileSync("${filePathNormalized}", "utf-8"));

    console.log(\`🚀 Processing \${testcases.length} test cases from ${fileName}...\`);
    
    let totalCost = 0;
    let totalTokens = 0;
    let processed = 0;

    for (const testcase of testcases) {
      try {
        const inputText = \`
          Module: \${testcase.module}
          ID: \${testcase.id}
          Pre-Requisites: \${testcase.preRequisites}
          Title: \${testcase.title}
          Description: \${testcase.description}
          Steps: \${testcase.steps}
          Expected Result: \${testcase.expectedResults}
          Automation/Manual: \${testcase.automationManual}
          Priority: \${testcase.priority}
          Created By: \${testcase.createdBy}
          Created Date: \${testcase.createdDate}
          Last Modified Date: \${testcase.lastModifiedDate}
          Risk: \${testcase.risk}
          Version: \${testcase.version}
          Type: \${testcase.type}
        \`;
        
        const embeddingResponse = await axios.post(
          \`\${TESTLEAF_API_BASE}/embedding/text/\${USER_EMAIL}\`,
          {
            input: inputText,
            model: "text-embedding-3-small"
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(AUTH_TOKEN && { 'Authorization': \`Bearer \${AUTH_TOKEN}\` })
            }
          }
        );

        if (embeddingResponse.data.status !== 200) {
          throw new Error(\`Testleaf API error: \${embeddingResponse.data.message}\`);
        }

        const vector = embeddingResponse.data.data[0].embedding;
        const cost = embeddingResponse.data.cost || 0;
        const tokens = embeddingResponse.data.usage?.total_tokens || 0;
        
        totalCost += cost;
        totalTokens += tokens;

        const doc = {
          ...testcase,
          embedding: vector,
          createdAt: new Date(),
          sourceFile: "${fileName}",
          embeddingMetadata: {
            model: embeddingResponse.data.model,
            cost: cost,
            tokens: tokens,
            apiSource: 'testleaf'
          }
        };

        await collection.insertOne(doc);
        processed++;
        
        console.log(\`✅ Processed \${processed}/\${testcases.length}: \${testcase.id}\`);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(\`❌ Error processing \${testcase.id}: \${error.message}\`);
        continue;
      }
    }

    console.log(\`\\n🎉 Processing complete for ${fileName}!\`);
    console.log(\`💰 Total Cost: $\${totalCost.toFixed(6)}\`);
    console.log(\`🔢 Total Tokens: \${totalTokens}\`);
    console.log(\`📊 Processed: \${processed}/\${testcases.length}\`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  } finally {
    await mongoClient.close();
  }
}

main();
`;

      const tempScriptPath = path.join(__dirname, `temp-embeddings-${Date.now()}.js`);
      fs.writeFileSync(tempScriptPath, scriptContent);

    try {
      await new Promise((resolve, reject) => {
        const child = spawn('node', [tempScriptPath], { cwd: __dirname });
        
        let output = '';
        let error = '';

        child.stdout.on('data', (data) => {
          output += data.toString();
        });

        child.stderr.on('data', (data) => {
          error += data.toString();
        });

        child.on('close', (code) => {
          fs.unlinkSync(tempScriptPath);
          
          if (code === 0) {
            results.push({
              file: fileName,
              status: 'completed',
              output
            });
            resolve();
          } else {
            results.push({
              file: fileName,
              status: 'failed',
              error: error || output
            });
            resolve(); // Continue with other files
          }
        });
      });
    } catch (error) {
      results.push({
        file: fileName,
        status: 'failed',
        error: error.message
      });
    }
    
    // Update job progress
    updateJob(jobId, {
      progress: results.length,
      results: [...results]
    });
  }

  // Mark job as complete
  updateJob(jobId, {
    status: 'completed',
    endTime: new Date(),
    results
  });
}

// Get environment variables
app.get('/api/env', (req, res) => {
  try {
    const envPath = path.join(__dirname, '../.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    
    const envVars = {};
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && key.trim() && !key.startsWith('#')) {
        envVars[key.trim()] = valueParts.join('=').replace(/"/g, '');
      }
    });

    res.json(envVars);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read environment variables', details: error.message });
  }
});

// Update environment variables
app.post('/api/env', (req, res) => {
  try {
    const { envVars } = req.body;
    const envPath = path.join(__dirname, '../.env');
    
    let envContent = '';
    Object.entries(envVars).forEach(([key, value]) => {
      envContent += `${key}="${value}"\n`;
    });

    fs.writeFileSync(envPath, envContent);
    
    res.json({ success: true, message: 'Environment variables updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update environment variables', details: error.message });
  }
});

// ======================== Query Preprocessing ========================
// Preprocess query: normalization, abbreviation expansion, synonym expansion
app.post('/api/search/preprocess', async (req, res) => {
  try {
    const { query, options = {} } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Import preprocessing modules dynamically
    const { preprocessQuery } = await import('../src/scripts/query-preprocessing/queryPreprocessor.js');

    // Preprocess the query
    const result = preprocessQuery(query, {
      enableAbbreviations: options.enableAbbreviations !== false,
      enableSynonyms: options.enableSynonyms !== false,
      maxSynonymVariations: options.maxSynonymVariations || 5,
      customAbbreviations: options.customAbbreviations || {},
      customSynonyms: options.customSynonyms || {},
      smartExpansion: options.smartExpansion || false,
      preserveTestCaseIds: options.preserveTestCaseIds !== false
    });

    res.json(result);
  } catch (error) {
    console.error('Preprocessing error:', error);
    res.status(500).json({ 
      error: 'Failed to preprocess query', 
      details: error.message 
    });
  }
});

// Analyze query (show what preprocessing would do without applying)
app.post('/api/search/analyze', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const { analyzeQuery } = await import('../src/scripts/query-preprocessing/queryPreprocessor.js');
    const analysis = analyzeQuery(query);

    res.json(analysis);
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze query', 
      details: error.message 
    });
  }
});

// ======================== Summarization & Deduplication ========================

// Deduplicate results based on similarity
app.post('/api/search/deduplicate', async (req, res) => {
  try {
    const { results, threshold = 0.85 } = req.body;
    
    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'Results array is required' });
    }

    const deduplicated = [];
    const duplicates = [];
    const seenTitles = new Map();

    for (const result of results) {
      const title = result.title?.toLowerCase() || '';
      const id = result.id || '';

      // Check for exact title match
      let isDuplicate = false;
      
      for (const [seenTitle, seenResult] of seenTitles.entries()) {
        // Calculate similarity (Jaccard similarity for simple implementation)
        const similarity = calculateTextSimilarity(title, seenTitle);
        
        if (similarity >= threshold) {
          isDuplicate = true;
          duplicates.push({
            ...result,
            duplicateOf: seenResult.id,
            similarity: similarity.toFixed(3)
          });
          break;
        }
      }

      if (!isDuplicate) {
        deduplicated.push(result);
        seenTitles.set(title, result);
      }
    }

    res.json({
      original: results,
      deduplicated,
      duplicates,
      stats: {
        originalCount: results.length,
        deduplicatedCount: deduplicated.length,
        duplicatesRemoved: duplicates.length,
        reductionPercentage: ((duplicates.length / results.length) * 100).toFixed(1)
      }
    });
  } catch (error) {
    console.error('Deduplication error:', error);
    res.status(500).json({ 
      error: 'Failed to deduplicate results', 
      details: error.message 
    });
  }
});

// Summarize search results using TestLeaf API
app.post('/api/search/summarize', async (req, res) => {
  try {
    const { results, summaryType = 'concise' } = req.body;
    
    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'Results array is required' });
    }

    if (results.length === 0) {
      return res.json({
        summary: 'No results to summarize',
        tokens: { prompt: 0, completion: 0, total: 0 },
        cost: 0
      });
    }

    // Prepare concise content for summarization (reduce detail to avoid large prompts)
    // Handle both field name formats and include key information only
    const resultsText = results.map((r, idx) => {
      const id = r.testCaseId || r.id || 'N/A';
      const title = r.testCaseTitle || r.title || 'No title';
      const module = r.module || 'Unknown';
      const priority = r.priority || 'N/A';
      const type = r.type || 'Functional';
      
      // Simplified format - just key fields
      return `${idx + 1}. ${id} | ${module} | ${priority} | ${type} | ${title}`;
    }).join('\n');

    const systemPrompt = summaryType === 'detailed'
      ? `You are a QA expert. Analyze test cases and provide a CONCISE summary covering:
1. Modules tested and main functionality
2. Priority distribution (P1/P2/P3)
3. Test coverage gaps
4. Key scenarios (positive, negative, edge cases)
Keep it under 300 words.`
      : 'You are a QA expert. Provide a concise summary of test cases in 2-3 sentences.';

    const userPrompt = summaryType === 'detailed' 
      ? `Analyze these ${results.length} test cases. Group by module, note priority distribution, identify coverage gaps:\n\n${resultsText}`
      : `Summarize these test cases:\n\n${resultsText}`;

    // Use Testleaf API for chat completion
    console.log('🔧 Testleaf Config Check:');
    console.log('   API Base:', TESTLEAF_API_BASE);
    console.log('   User Email:', USER_EMAIL);
    console.log('   Auth Token:', AUTH_TOKEN ? `${AUTH_TOKEN.substring(0, 5)}...` : 'NOT SET');
    
    if (!TESTLEAF_API_BASE || !USER_EMAIL || !AUTH_TOKEN) {
      throw new Error('TESTLEAF_API_BASE, USER_EMAIL, and AUTH_TOKEN are required for summarization feature');
    }
    
    // Use Testleaf chat completions endpoint
    const apiUrl = `${TESTLEAF_API_BASE}/v1/chat/completions`;
    console.log('🌐 Making request to:', apiUrl);

    const response = await axios.post(apiUrl, {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: summaryType === 'detailed' ? 400 : 200  // Reduced from 1000 to 400 to avoid large summaries
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });

    // Log the response for debugging
    console.log('Testleaf API Response:', JSON.stringify(response.data, null, 2));

    // Check if response has expected structure (Testleaf API transaction response)
    if (!response.data || !response.data.transaction || !response.data.transaction.response) {
      throw new Error(`Unexpected API response structure: ${JSON.stringify(response.data)}`);
    }

    // Testleaf API response structure (wrapped in transaction)
    const openaiResponse = response.data.transaction.response;
    const summary = openaiResponse.choices[0].message.content;
    const usage = openaiResponse.usage;

    // Extract cost from Testleaf response 
    const totalCost = response.data.transaction.cost || 0;
    const inputCost = totalCost * 0.15; // Approximate input cost based on gpt-4o-mini pricing
    const outputCost = totalCost * 0.85; // Approximate output cost

    res.json({
      summary,
      tokens: {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens
      },
      cost: {
        input: inputCost.toFixed(6),
        output: outputCost.toFixed(6),
        total: totalCost.toFixed(6)
      },
      model: 'gpt-4o-mini',
      summaryType
    });
  } catch (error) {
    console.error('Summarization error:', error);
    console.error('Error response:', error.response?.data);
    console.error('Error status:', error.response?.status);
    
    res.status(500).json({ 
      error: 'Failed to summarize results', 
      details: error.message,
      apiError: error.response?.data,
      hint: 'Make sure TESTLEAF_API_BASE, USER_EMAIL, and AUTH_TOKEN are set in .env file'
    });
  }
});

// ======================== Test Prompt Endpoint ========================
app.post('/api/test-prompt', async (req, res) => {
  try {
    const { prompt, temperature = 0.5, maxTokens = 15000 } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Use Testleaf API for chat completion
    console.log('🔧 Testleaf Config Check (Prompt Testing):');
    console.log('   API Base:', TESTLEAF_API_BASE);
    console.log('   User Email:', USER_EMAIL);
    console.log('   Auth Token:', AUTH_TOKEN ? `${AUTH_TOKEN.substring(0, 5)}...` : 'NOT SET');
    
    if (!TESTLEAF_API_BASE || !USER_EMAIL || !AUTH_TOKEN) {
      throw new Error('TESTLEAF_API_BASE, USER_EMAIL, and AUTH_TOKEN are required for prompt testing');
    }
    
    const apiUrl = `${TESTLEAF_API_BASE}/v1/chat/completions`;
    console.log('🌐 Making request to:', apiUrl);

    const requestData = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: temperature,
      max_tokens: maxTokens
    };
    console.log('📤 Request data:', JSON.stringify(requestData, null, 2));
    console.log('📤 Request headers:', { 'Authorization': AUTH_TOKEN ? `Bearer ${AUTH_TOKEN.substring(0, 8)}...` : 'NOT SET' });

    const response = await axios.post(apiUrl, requestData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      },
      timeout: 300000, // 5 minutes timeout (instead of default 60s)
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    // Check if response has expected structure (Testleaf API transaction response)
    if (!response.data || !response.data.transaction || !response.data.transaction.response) {
      throw new Error(`Unexpected API response structure: ${JSON.stringify(response.data)}`);
    }

    // Extract data from Testleaf response structure (wrapped in transaction)
    const openaiResponse = response.data.transaction.response;
    const aiResponse = openaiResponse.choices[0].message.content;
    const usage = openaiResponse.usage;

    // Extract cost from Testleaf response
    const totalCost = response.data.transaction.cost || 0;
    const inputCost = totalCost * 0.15; // Approximate input cost based on gpt-4o-mini pricing
    const outputCost = totalCost * 0.85; // Approximate output cost

    // Try to parse as JSON
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (e) {
      parsedResponse = { raw: aiResponse };
    }

    res.json({
      response: parsedResponse,
      tokens: {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens
      },
      cost: {
        input: inputCost.toFixed(6),
        output: outputCost.toFixed(6),
        total: totalCost.toFixed(6)
      },
      model: 'gpt-4o-mini'
    });
  } catch (error) {
    console.error('Prompt test error:', error);
    res.status(500).json({ 
      error: 'Failed to test prompt', 
      details: error.message
    });
  }
});

// Helper function to calculate text similarity (Jaccard similarity)
function calculateTextSimilarity(text1, text2) {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

// Search vector database
app.post('/api/search', async (req, res) => {
  try {
    const { query, limit = 5, filters = {} } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Create a MongoClient, connect once, validate DB/collection/index and reuse for the search
    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });
    await mongoClient.connect();
    // Validate DB/collection/index and ensure documents exist
    const validation = await validateDbCollectionIndex(mongoClient, process.env.DB_NAME, process.env.COLLECTION_NAME, process.env.VECTOR_INDEX_NAME, true);
    if (!validation.ok) {
      try { await mongoClient.close(); } catch (e) {}
      return res.status(400).json({ error: validation.error });
    }

    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    // Generate embedding for query
    const TESTLEAF_API_BASE = process.env.TESTLEAF_API_BASE || 'https://api.testleaf.ai';
    const USER_EMAIL = process.env.USER_EMAIL;
    const AUTH_TOKEN = process.env.AUTH_TOKEN;

    const embeddingResponse = await axios.post(
      `${TESTLEAF_API_BASE}/embedding/text/${USER_EMAIL}`,
      {
        input: query,
        model: "text-embedding-3-small"
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AUTH_TOKEN}`
        }
      }
    );

    if (embeddingResponse.data.status !== 200) {
      throw new Error(`Testleaf API error: ${embeddingResponse.data.message}`);
    }

    const queryVector = embeddingResponse.data.data[0].embedding;

    // Calculate candidates and internal limit for vector search
    const requestedLimit = parseInt(limit);
    const numCandidates = Math.max(100, requestedLimit * 10); // At least 100 candidates
    const vectorSearchLimit = Math.min(numCandidates, requestedLimit * 10); // Limit must be <= numCandidates

    // Build vector search WITHOUT pre-filtering (to avoid index requirement)
    const vectorSearchStage = {
      $vectorSearch: {
        queryVector,
        path: "embedding",
        numCandidates: numCandidates,
        limit: vectorSearchLimit, // Get more candidates for post-filtering
        index: process.env.VECTOR_INDEX_NAME
      }
    };

    // Build the pipeline
    const pipeline = [
      vectorSearchStage,
      {
        $addFields: {
          score: { $meta: "vectorSearchScore" }
        }
      }
    ];

    // Apply metadata filters using $match stage (works without index)
    if (Object.keys(filters).length > 0) {
      const matchConditions = {};
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          matchConditions[key] = value;
        }
      });
      pipeline.push({
        $match: matchConditions
      });
      console.log('🔍 Applying filters with $match:', matchConditions);
    }

    // Add limit after filtering
    pipeline.push({
      $limit: requestedLimit
    });

    // Project fields
    pipeline.push({
      $project: {
        id: 1,
        module: 1,
        preRequisites: 1,
        title: 1,
        description: 1,
        steps: 1,
        expectedResults: 1,
        automationManual: 1,
        priority: 1,
        createdBy: 1,
        createdDate: 1,
        lastModifiedDate: 1,
        risk: 1,
        version: 1,
        type: 1,
        sourceFile: 1,
        createdAt: 1,
        score: 1
      }
    });

    console.log('🔍 Search Query:', query);
    console.log('🔍 Filters:', JSON.stringify(filters));
    console.log('🔍 Pipeline:', JSON.stringify(pipeline, null, 2));

    const results = await collection.aggregate(pipeline).toArray();
    console.log('✅ Found results:', results.length);
    
    await mongoClient.close();

    const responseData = {
      success: true,
      query,
      filters,
      results,
      cost: embeddingResponse.data.cost || 0,
      tokens: embeddingResponse.data.usage?.total_tokens || 0
    };
    
    console.log('📤 Sending response with', results.length, 'results');
    res.json(responseData);

  } catch (error) {
    console.error('❌ Search failed:', error.message);
    console.error('Error details:', error);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

// ======================== BM25 Search Endpoint ========================
app.post('/api/search/bm25', async (req, res) => {
  try {
    const { query, limit = 10, filters = {}, fields = ['id', 'title', 'description', 'steps', 'expectedResults', 'module'] } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`🔤 BM25 Search request: "${query}"`);
    console.log(`   Limit: ${limit}`);
    console.log(`   Filters:`, filters);

    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    await mongoClient.connect();

    const validation = await validateDbCollectionIndex(
      mongoClient, 
      process.env.DB_NAME, 
      process.env.COLLECTION_NAME, 
      process.env.BM25_INDEX_NAME,
      true
    );
    
    if (!validation.ok) {
      try { await mongoClient.close(); } catch (e) {}
      return res.status(400).json({ error: validation.error });
    }

    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    // Build BM25 search pipeline
    const pipeline = [
      {
        $search: {
          index: process.env.BM25_INDEX_NAME,
          text: {
            query: query,
            path: fields,
            fuzzy: {
              maxEdits: 1,
              prefixLength: 2
            }
          }
        }
      },
      {
        $addFields: {
          score: { $meta: "searchScore" }
        }
      }
    ];

    // Apply filters if provided
    if (Object.keys(filters).length > 0) {
      const matchConditions = {};
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== '') {
          matchConditions[key] = value;
        }
      });

      if (Object.keys(matchConditions).length > 0) {
        pipeline.push({ $match: matchConditions });
      }
    }

    // Add projection and limit
    pipeline.push(
      {
        $project: {
          id: 1,
          module: 1,
          title: 1,
          description: 1,
          steps: 1,
          expectedResults: 1,
          priority: 1,
          risk: 1,
          automationManual: 1,
          sourceFile: 1,
          createdAt: 1,
          score: 1
        }
      },
      { $limit: parseInt(limit) }
    );

    console.log('🔍 BM25 Pipeline:', JSON.stringify(pipeline, null, 2));

    const startTime = Date.now();
    const results = await collection.aggregate(pipeline).toArray();
    const searchTime = Date.now() - startTime;

    await mongoClient.close();

    console.log(`✅ BM25 Search complete: ${results.length} results in ${searchTime}ms`);

    res.json({
      success: true,
      searchType: 'bm25',
      query,
      filters,
      results,
      count: results.length,
      searchTime,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ BM25 Search error:', error);
    res.status(500).json({ 
      error: 'BM25 search failed', 
      details: error.message 
    });
  }
});

// ======================== Hybrid Search Endpoint (BM25 + Vector) ========================
app.post('/api/search/hybrid', async (req, res) => {
  try {
    const { 
      query, 
      limit = 10, 
      filters = {},
      bm25Weight = 0.5,
      vectorWeight = 0.5,
      bm25Fields = ['id', 'title', 'description', 'steps', 'expectedResults', 'module']
    } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`🔀 Hybrid Search request: "${query}"`);
    console.log(`   BM25 Weight: ${bm25Weight}, Vector Weight: ${vectorWeight}`);

    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    await mongoClient.connect();

    // Validate both indexes exist
    const bm25Validation = await validateDbCollectionIndex(
      mongoClient, 
      process.env.DB_NAME, 
      process.env.COLLECTION_NAME, 
      process.env.BM25_INDEX_NAME,
      true
    );
    
    const vectorValidation = await validateDbCollectionIndex(
      mongoClient, 
      process.env.DB_NAME, 
      process.env.COLLECTION_NAME, 
      process.env.VECTOR_INDEX_NAME,
      true
    );

    if (!bm25Validation.ok) {
      await mongoClient.close();
      return res.status(400).json({ error: `BM25 Index: ${bm25Validation.error}` });
    }

    if (!vectorValidation.ok) {
      await mongoClient.close();
      return res.status(400).json({ error: `Vector Index: ${vectorValidation.error}` });
    }

    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    const searchLimit = parseInt(limit) * 3; // Get more for better combination

    // 1. BM25 Search
    console.log('🔤 Running BM25 search...');
    const bm25StartTime = Date.now();
    
    const bm25Pipeline = [
      {
        $search: {
          index: process.env.BM25_INDEX_NAME,
          text: {
            query: query,
            path: bm25Fields,
            fuzzy: {
              maxEdits: 1,
              prefixLength: 2
            }
          }
        }
      },
      {
        $addFields: {
          bm25Score: { $meta: "searchScore" }
        }
      },
      {
        $project: {
          _id: 1,
          id: 1,
          module: 1,
          title: 1,
          description: 1,
          steps: 1,
          expectedResults: 1,
          priority: 1,
          risk: 1,
          automationManual: 1,
          sourceFile: 1,
          createdAt: 1,
          bm25Score: 1
        }
      },
      { $limit: searchLimit }
    ];

    const bm25Results = await collection.aggregate(bm25Pipeline).toArray();
    const bm25Time = Date.now() - bm25StartTime;

    // 2. Vector Search
    console.log('🧠 Running vector search...');
    const vectorStartTime = Date.now();

    const TESTLEAF_API_BASE = process.env.TESTLEAF_API_BASE || 'https://api.testleaf.com/ai';
    const USER_EMAIL = process.env.USER_EMAIL;
    const AUTH_TOKEN = process.env.AUTH_TOKEN;

    const embeddingResponse = await axios.post(
      `${TESTLEAF_API_BASE}/embedding/text/${USER_EMAIL}`,
      {
        input: query,
        model: "text-embedding-3-small"
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AUTH_TOKEN}`
        }
      }
    );

    if (embeddingResponse.data.status !== 200) {
      throw new Error(`Testleaf API error: ${embeddingResponse.data.message}`);
    }

    const queryVector = embeddingResponse.data.data[0].embedding;

    // Ensure numCandidates >= limit for MongoDB vector search
    const vectorNumCandidates = Math.max(searchLimit * 2, 200);

    const vectorPipeline = [
      {
        $vectorSearch: {
          queryVector,
          path: "embedding",
          numCandidates: vectorNumCandidates,
          limit: searchLimit,
          index: process.env.VECTOR_INDEX_NAME
        }
      },
      {
        $addFields: {
          vectorScore: { $meta: "vectorSearchScore" }
        }
      },
      {
        $project: {
          _id: 1,
          id: 1,
          module: 1,
          title: 1,
          description: 1,
          steps: 1,
          expectedResults: 1,
          priority: 1,
          risk: 1,
          automationManual: 1,
          sourceFile: 1,
          createdAt: 1,
          vectorScore: 1
        }
      }
    ];

    const vectorResults = await collection.aggregate(vectorPipeline).toArray();
    const vectorTime = Date.now() - vectorStartTime;

    // 3. Normalize and combine scores
    console.log('🔀 Combining results...');
    
    // Normalize BM25 scores
    const bm25Scores = bm25Results.map(r => r.bm25Score);
    const bm25Max = Math.max(...bm25Scores, 1);
    const bm25Min = Math.min(...bm25Scores, 0);
    const bm25Range = bm25Max - bm25Min || 1;

    // Normalize Vector scores
    const vectorScores = vectorResults.map(r => r.vectorScore);
    const vectorMax = Math.max(...vectorScores, 1);
    const vectorMin = Math.min(...vectorScores, 0);
    const vectorRange = vectorMax - vectorMin || 1;

    // Create result map
    const resultMap = new Map();

    // Add BM25 results with normalized scores
    bm25Results.forEach(result => {
      const key = result._id.toString();
      const normalizedScore = (result.bm25Score - bm25Min) / bm25Range;
      resultMap.set(key, {
        ...result,
        bm25ScoreNormalized: normalizedScore,
        vectorScore: 0,
        vectorScoreNormalized: 0,
        hybridScore: normalizedScore * bm25Weight,
        foundIn: 'bm25'
      });
    });

    // Add/merge vector results with normalized scores
    vectorResults.forEach(result => {
      const key = result._id.toString();
      const normalizedScore = (result.vectorScore - vectorMin) / vectorRange;
      
      if (resultMap.has(key)) {
        // Merge - found in both
        const existing = resultMap.get(key);
        existing.vectorScore = result.vectorScore;
        existing.vectorScoreNormalized = normalizedScore;
        existing.hybridScore += normalizedScore * vectorWeight;
        existing.foundIn = 'both';
      } else {
        // New result - only in vector
        resultMap.set(key, {
          ...result,
          bm25Score: 0,
          bm25ScoreNormalized: 0,
          vectorScoreNormalized: normalizedScore,
          hybridScore: normalizedScore * vectorWeight,
          foundIn: 'vector'
        });
      }
    });

    // Convert to array and sort by hybrid score
    let combinedResults = Array.from(resultMap.values());
    combinedResults.sort((a, b) => b.hybridScore - a.hybridScore);

    // Apply filters if provided
    if (Object.keys(filters).length > 0) {
      combinedResults = combinedResults.filter(result => {
        return Object.entries(filters).every(([key, value]) => {
          if (!value || value === '') return true;
          return result[key] === value;
        });
      });
    }

    // Limit results
    const finalResults = combinedResults.slice(0, parseInt(limit));

    await mongoClient.close();

    const totalTime = Date.now() - bm25StartTime;
    console.log(`✅ Hybrid Search complete: ${finalResults.length} results in ${totalTime}ms`);

    // Calculate statistics
    const bothCount = finalResults.filter(r => r.foundIn === 'both').length;
    const bm25OnlyCount = finalResults.filter(r => r.foundIn === 'bm25').length;
    const vectorOnlyCount = finalResults.filter(r => r.foundIn === 'vector').length;

    res.json({
      success: true,
      searchType: 'hybrid',
      query,
      filters,
      weights: { bm25: bm25Weight, vector: vectorWeight },
      results: finalResults,
      count: finalResults.length,
      stats: {
        foundInBoth: bothCount,
        foundInBm25Only: bm25OnlyCount,
        foundInVectorOnly: vectorOnlyCount,
        bm25ResultCount: bm25Results.length,
        vectorResultCount: vectorResults.length
      },
      timing: {
        bm25Time,
        vectorTime,
        totalTime
      },
      cost: embeddingResponse.data.cost || 0,
      tokens: embeddingResponse.data.usage?.total_tokens || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Hybrid Search error:', error);
    res.status(500).json({ 
      error: 'Hybrid search failed', 
      details: error.message 
    });
  }
});

// Reranking endpoint with Score Fusion and Normalization
app.post('/api/search/rerank', async (req, res) => {
  try {
    const { 
      query, 
      limit = 10, 
      filters = {}, 
      fusionMethod = 'rrf', // rrf, weighted, or reciprocal
      rerankTopK = 50,
      bm25Weight = 0.4,
      vectorWeight = 0.6
    } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const startTime = Date.now();

    // Create a MongoClient
    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });
    await mongoClient.connect();

    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    console.log(`\n🔄 Reranking Search with Score Fusion for: "${query}"`);
    console.log(`📊 Fusion Method: ${fusionMethod.toUpperCase()}, Top-K: ${rerankTopK}, Final Limit: ${limit}`);

    // Step 1: Get both BM25 and Vector results
    const TESTLEAF_API_BASE = process.env.TESTLEAF_API_BASE || 'https://api.testleaf.com/ai';
    const USER_EMAIL = process.env.USER_EMAIL;
    const AUTH_TOKEN = process.env.AUTH_TOKEN;

    // Generate embedding for vector search
    const embeddingResponse = await axios.post(
      `${TESTLEAF_API_BASE}/embedding/text/${USER_EMAIL}`,
      {
        input: query,
        model: "text-embedding-3-small"
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AUTH_TOKEN}`
        }
      }
    );

    if (embeddingResponse.data.status !== 200) {
      throw new Error(`Testleaf API error: ${embeddingResponse.data.message}`);
    }

    const queryVector = embeddingResponse.data.data[0].embedding;
    const embeddingCost = embeddingResponse.data.cost || 0;
    const embeddingTokens = embeddingResponse.data.usage?.total_tokens || 0;

    // Parallel search: BM25 and Vector
    const searchStartTime = Date.now();

    // BM25 Pipeline
    const weights = {
      id: 10.0,
      title: 8.0,
      module: 5.0,
      description: 2.0,
      expectedResults: 1.5,
      steps: 1.0,
      preRequisites: 0.8
    };

    const searchFields = Object.entries(weights).map(([field, weight]) => ({
      text: {
        query: query,
        path: field,
        fuzzy: { maxEdits: 1, prefixLength: 2 },
        score: { boost: { value: weight } }
      }
    }));

    const bm25Pipeline = [
      {
        $search: {
          index: process.env.BM25_INDEX_NAME,
          compound: {
            should: searchFields,
            minimumShouldMatch: 1
          }
        }
      },
      {
        $addFields: {
          bm25Score: { $meta: "searchScore" }
        }
      },
      { $limit: rerankTopK }
    ];

    if (Object.keys(filters).length > 0) {
      bm25Pipeline.push({ $match: filters });
    }

    // Vector Pipeline
    const vectorPipeline = [
      {
        $vectorSearch: {
          queryVector,
          path: "embedding",
          numCandidates: Math.max(rerankTopK * 2, 100),
          limit: rerankTopK,
          index: process.env.VECTOR_INDEX_NAME,
          ...(Object.keys(filters).length > 0 && { filter: filters })
        }
      },
      {
        $addFields: {
          vectorScore: { $meta: "vectorSearchScore" }
        }
      },
      { $project: { embedding: 0 } }
    ];

    // Execute both searches in parallel
    const [bm25Results, vectorResults] = await Promise.all([
      collection.aggregate(bm25Pipeline).toArray(),
      collection.aggregate(vectorPipeline).toArray()
    ]);

    const searchTime = Date.now() - searchStartTime;
    console.log(`✅ Retrieved ${bm25Results.length} BM25 + ${vectorResults.length} Vector results in ${searchTime}ms`);

    // Step 2: Score Fusion and Normalization
    const rerankStartTime = Date.now();
    console.log(`🔄 Applying ${fusionMethod.toUpperCase()} score fusion...`);

    // Create a map to combine results
    const resultMap = new Map();

    // Normalize scores using min-max normalization
    const normalizeBM25 = (score, minScore, maxScore) => {
      if (maxScore === minScore) return 1.0;
      return (score - minScore) / (maxScore - minScore);
    };

    const normalizeVector = (score, minScore, maxScore) => {
      if (maxScore === minScore) return 1.0;
      return (score - minScore) / (maxScore - minScore);
    };

    // Get min/max scores for normalization
    const bm25Scores = bm25Results.map(r => r.bm25Score);
    const vectorScores = vectorResults.map(r => r.vectorScore);
    const minBM25 = Math.min(...bm25Scores, 0);
    const maxBM25 = Math.max(...bm25Scores, 1);
    const minVector = Math.min(...vectorScores, 0);
    const maxVector = Math.max(...vectorScores, 1);

    // Process BM25 results
    bm25Results.forEach((doc, index) => {
      const id = doc._id.toString();
      const normalizedScore = normalizeBM25(doc.bm25Score, minBM25, maxBM25);
      
      resultMap.set(id, {
        ...doc,
        bm25Score: doc.bm25Score,
        bm25Normalized: normalizedScore,
        bm25Rank: index + 1,
        vectorScore: 0,
        vectorNormalized: 0,
        vectorRank: null,
        foundIn: 'bm25'
      });
    });

    // Process Vector results and merge
    vectorResults.forEach((doc, index) => {
      const id = doc._id.toString();
      const normalizedScore = normalizeVector(doc.vectorScore, minVector, maxVector);
      
      if (resultMap.has(id)) {
        // Document found in both
        const existing = resultMap.get(id);
        existing.vectorScore = doc.vectorScore;
        existing.vectorNormalized = normalizedScore;
        existing.vectorRank = index + 1;
        existing.foundIn = 'both';
      } else {
        // Document only in vector
        resultMap.set(id, {
          ...doc,
          bm25Score: 0,
          bm25Normalized: 0,
          bm25Rank: null,
          vectorScore: doc.vectorScore,
          vectorNormalized: normalizedScore,
          vectorRank: index + 1,
          foundIn: 'vector'
        });
      }
    });

    // Convert to array for processing
    const allResults = Array.from(resultMap.values());

    // Apply fusion method
    let fusedResults = [];

    if (fusionMethod === 'rrf') {
      // Reciprocal Rank Fusion (RRF)
      const k = 60; // RRF constant
      fusedResults = allResults.map(doc => {
        const bm25RRF = doc.bm25Rank ? 1 / (k + doc.bm25Rank) : 0;
        const vectorRRF = doc.vectorRank ? 1 / (k + doc.vectorRank) : 0;
        const fusedScore = bm25RRF + vectorRRF;
        
        return {
          ...doc,
          fusedScore,
          fusionComponents: {
            bm25RRF: bm25RRF.toFixed(4),
            vectorRRF: vectorRRF.toFixed(4)
          }
        };
      });
    } else if (fusionMethod === 'weighted') {
      // Weighted normalized scores
      fusedResults = allResults.map(doc => {
        const fusedScore = (doc.bm25Normalized * bm25Weight) + (doc.vectorNormalized * vectorWeight);
        
        return {
          ...doc,
          fusedScore,
          fusionComponents: {
            bm25Contribution: (doc.bm25Normalized * bm25Weight).toFixed(4),
            vectorContribution: (doc.vectorNormalized * vectorWeight).toFixed(4)
          }
        };
      });
    } else if (fusionMethod === 'reciprocal') {
      // Reciprocal scoring with weights
      fusedResults = allResults.map(doc => {
        const bm25Reciprocal = doc.bm25Rank ? (1 / doc.bm25Rank) * bm25Weight : 0;
        const vectorReciprocal = doc.vectorRank ? (1 / doc.vectorRank) * vectorWeight : 0;
        const fusedScore = bm25Reciprocal + vectorReciprocal;
        
        return {
          ...doc,
          fusedScore,
          fusionComponents: {
            bm25Reciprocal: bm25Reciprocal.toFixed(4),
            vectorReciprocal: vectorReciprocal.toFixed(4)
          }
        };
      });
    }

    // Sort by fused score
    fusedResults.sort((a, b) => b.fusedScore - a.fusedScore);

    // Add ranking information
    fusedResults.forEach((doc, index) => {
      doc.newRank = index + 1;
      doc.originalRank = doc.bm25Rank || doc.vectorRank || index + 1;
      doc.rankChange = doc.originalRank - doc.newRank;
    });

    const rerankingTime = Date.now() - rerankStartTime;

    // Get before/after results
    const beforeResults = (fusionMethod === 'rrf' ? vectorResults : bm25Results).slice(0, limit);
    const afterResults = fusedResults.slice(0, limit);
    const totalTime = Date.now() - startTime;

    console.log(`✅ Score fusion complete in ${rerankingTime}ms`);
    console.log(`📊 Top result: ${afterResults[0]?.id} (Found in: ${afterResults[0]?.foundIn})`);

    await mongoClient.close();

    // Calculate statistics
    const bothCount = fusedResults.filter(r => r.foundIn === 'both').length;
    const bm25OnlyCount = fusedResults.filter(r => r.foundIn === 'bm25').length;
    const vectorOnlyCount = fusedResults.filter(r => r.foundIn === 'vector').length;

    res.json({
      success: true,
      fusionMethod,
      query,
      filters,
      results: afterResults,
      beforeReranking: beforeResults,
      afterReranking: afterResults,
      reranked: true,
      count: afterResults.length,
      totalCandidates: fusedResults.length,
      rerankTopK,
      searchTime,
      rerankingTime,
      totalTime,
      cost: embeddingCost,
      tokens: embeddingTokens,
      weights: { bm25: bm25Weight, vector: vectorWeight },
      stats: {
        foundInBoth: bothCount,
        foundInBm25Only: bm25OnlyCount,
        foundInVectorOnly: vectorOnlyCount,
        topResultChanged: beforeResults[0]?.id !== afterResults[0]?.id,
        significantReorderings: afterResults.filter(r => Math.abs(r.rankChange) >= 5).length,
        averageFusedScore: (afterResults.reduce((sum, r) => sum + r.fusedScore, 0) / afterResults.length).toFixed(4)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Reranking error:', error);
    res.status(500).json({ 
      error: 'Reranking failed', 
      details: error.message 
    });
  }
});

// Get the latest test case ID from the database
app.get('/api/testcases/latest-id', async (req, res) => {
  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
    });

    await mongoClient.connect();
    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    // Find the highest numeric test case ID
    const testCases = await collection.find({}, { projection: { id: 1 } }).toArray();
    
    let maxId = 0;
    testCases.forEach(tc => {
      if (tc.id) {
        // Extract numeric part from TC_XXXX format
        const match = tc.id.match(/TC_(\d+)/);
        if (match) {
          const numId = parseInt(match[1], 10);
          if (numId > maxId) {
            maxId = numId;
          }
        }
      }
    });

    await mongoClient.close();

    res.json({
      success: true,
      latestId: maxId,
      nextId: maxId + 1,
      nextTestCaseId: `TC_${String(maxId + 1).padStart(4, '0')}`,
      totalTestCases: testCases.length
    });

  } catch (error) {
    console.error('❌ Error fetching latest test case ID:', error);
    res.status(500).json({ 
      error: 'Failed to fetch latest test case ID', 
      details: error.message 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
});