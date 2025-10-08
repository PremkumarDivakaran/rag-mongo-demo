import { MongoClient } from "mongodb";
import dns from "dns";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import pLimit from "p-limit";

dotenv.config();

// Fix DNS resolution issue on macOS by using Google's DNS servers
dns.setServers(['8.8.8.8', '8.8.4.4']);

// Configure MongoDB client with SSL options
const client = new MongoClient(process.env.MONGODB_URI, {
  ssl: true,
  tlsAllowInvalidCertificates: true,
  tlsAllowInvalidHostnames: true,
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
  maxPoolSize: 20 // Increased connection pool for batch processing
});

// Testleaf API configuration
const TESTLEAF_API_BASE = process.env.TESTLEAF_API_BASE || 'https://api.testleaf.ai';
const USER_EMAIL = process.env.USER_EMAIL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// User Stories specific configuration
const USER_STORIES_COLLECTION = process.env.USER_STORIES_COLLECTION || 'user_stories';
const USER_STORIES_DATA_FILE = "src/data/stories.json";

// BATCH PROCESSING CONFIGURATION
const BATCH_SIZE = 20; // Process 20 user stories at once
const CONCURRENT_LIMIT = 8; // Max 8 concurrent API calls
const DELAY_BETWEEN_BATCHES = 800; // 800ms delay between batches
const MONGODB_BATCH_SIZE = 50; // Insert 50 documents at once

// Create limiters for different operations
const embeddingLimit = pLimit(CONCURRENT_LIMIT);
const dbLimit = pLimit(3); // Limit DB operations

/**
 * Create comprehensive input text for user story embedding
 */
function createUserStoryInputText(userStory) {
  const components = Array.isArray(userStory.components) ? userStory.components.join(', ') : '';
  const labels = Array.isArray(userStory.labels) ? userStory.labels.join(', ') : '';
  const fixVersions = Array.isArray(userStory.fixVersions) ? userStory.fixVersions.join(', ') : '';
  
  return `
    Story Key: ${userStory.key || ''}
    Summary: ${userStory.summary || ''}
    Description: ${userStory.description || ''}
    Status: ${userStory.status?.name || ''}
    Priority: ${userStory.priority?.name || ''}
    Assignee: ${userStory.assignee?.displayName || ''}
    Reporter: ${userStory.reporter?.displayName || ''}
    Project: ${userStory.project || ''}
    Epic: ${userStory.epic || ''}
    Story Points: ${userStory.storyPoints || ''}
    Components: ${components}
    Labels: ${labels}
    Fix Versions: ${fixVersions}
    Acceptance Criteria: ${userStory.acceptanceCriteria || ''}
    Business Value: ${userStory.businessValue || ''}
    Dependencies: ${userStory.dependencies || ''}
    Notes: ${userStory.notes || ''}
  `.trim();
}

/**
 * Generate embedding for a single user story with retry logic
 */
async function generateUserStoryEmbedding(userStory, index, total, maxRetries = 3) {
  return embeddingLimit(async () => {
    const storyKey = userStory.key || `US-${index + 1}`;
    const storySummary = userStory.summary || 'Untitled Story';
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create comprehensive input text for embedding
        const inputText = createUserStoryInputText(userStory);
        
        const embeddingResponse = await axios.post(
          `${TESTLEAF_API_BASE}/embedding/text/${USER_EMAIL}`,
          {
            input: inputText,
            model: "text-embedding-3-small"
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(AUTH_TOKEN && { 'Authorization': `Bearer ${AUTH_TOKEN}` })
            },
            timeout: 30000
          }
        );

        if (embeddingResponse.data.status !== 200) {
          throw new Error(`API error: ${embeddingResponse.data.message}`);
        }

        const vector = embeddingResponse.data.data[0].embedding;
        const cost = embeddingResponse.data.cost || 0;
        const tokens = embeddingResponse.data.usage?.total_tokens || 0;
        
        // Success - log every 50th item to avoid spam
        if (index % 50 === 0 || index === total - 1) {
          console.log(`✅ [${index + 1}/${total}] ${storyKey} | Cost: $${cost.toFixed(6)} | Tokens: ${tokens}`);
        }

        return {
          userStory,
          embedding: vector,
          cost,
          tokens,
          inputText,
          metadata: {
            model: embeddingResponse.data.model,
            cost: cost,
            tokens: tokens,
            apiSource: 'testleaf',
            inputTextLength: inputText.length,
            generatedAt: new Date().toISOString()
          }
        };

      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          console.log(`⚠️ [${index + 1}/${total}] Retry ${attempt}/${maxRetries} for ${storyKey}: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        }
      }
    }

    console.error(`❌ [${index + 1}/${total}] Final failure for ${storyKey}: ${lastError.message}`);
    return {
      userStory,
      error: lastError.message,
      cost: 0,
      tokens: 0
    };
  });
}

/**
 * Optimized batch MongoDB insertion for user stories
 */
async function insertUserStoriesBatch(collection, batch) {
  return dbLimit(async () => {
    if (batch.length === 0) return { inserted: 0, failed: 0 };

    const documents = batch
      .filter(item => !item.error)
      .map(item => ({
        ...item.userStory,
        embedding: item.embedding,
        createdAt: new Date(),
        embeddingMetadata: item.metadata,
        searchableText: item.inputText,
        lastEmbeddingUpdate: new Date()
      }));

    if (documents.length === 0) {
      return { inserted: 0, failed: batch.length };
    }

    try {
      // Use insertMany with unordered writes for better performance
      const result = await collection.insertMany(documents, { 
        ordered: false,
        writeConcern: { w: 1 } // Faster write concern
      });
      
      const failed = batch.length - documents.length;
      return { inserted: result.insertedCount, failed };
      
    } catch (error) {
      console.error(`❌ User Stories batch insert failed:`, error.message);
      return { inserted: 0, failed: batch.length };
    }
  });
}

/**
 * Progress tracking with ETA calculation for user stories
 */
class UserStoryProgressTracker {
  constructor(total) {
    this.total = total;
    this.processed = 0;
    this.startTime = Date.now();
    this.lastUpdate = Date.now();
    this.totalCost = 0;
    this.totalTokens = 0;
  }

  update(processed, cost = 0, tokens = 0) {
    this.processed = processed;
    this.totalCost += cost;
    this.totalTokens += tokens;

    const now = Date.now();
    const elapsed = (now - this.startTime) / 1000;
    const rate = this.processed / elapsed;
    const remaining = this.total - this.processed;
    const eta = remaining / rate;

    // Update every 15 seconds or on completion
    if (now - this.lastUpdate > 15000 || this.processed === this.total) {
      console.log(`📊 User Stories Progress: ${this.processed}/${this.total} (${(this.processed/this.total*100).toFixed(1)}%) | Rate: ${rate.toFixed(1)}/sec | ETA: ${this.formatTime(eta)} | Cost: $${this.totalCost.toFixed(6)}`);
      this.lastUpdate = now;
    }
  }

  formatTime(seconds) {
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    if (seconds < 3600) return `${Math.floor(seconds/60)}m ${(seconds%60).toFixed(0)}s`;
    return `${Math.floor(seconds/3600)}h ${Math.floor((seconds%3600)/60)}m`;
  }
}

async function main() {
  const overallStart = Date.now();
  
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const collection = db.collection(USER_STORIES_COLLECTION);

    // Check if user stories data file exists
    if (!fs.existsSync(USER_STORIES_DATA_FILE)) {
      console.error(`❌ User stories data file not found: ${USER_STORIES_DATA_FILE}`);
      console.log(`💡 Please create user stories data first by:`);
      console.log(`   1. Converting Excel to JSON using excel-to-userstories.js`);
      console.log(`   2. Or fetching from Jira using fetch-jira-stories.js`);
      process.exit(1);
    }

    // Load user stories
    const userStories = JSON.parse(fs.readFileSync(USER_STORIES_DATA_FILE, "utf-8"));
    const progress = new UserStoryProgressTracker(userStories.length);

    console.log(`🚀 BATCH PROCESSING: ${userStories.length} user stories`);
    console.log(`⚙️  Configuration for User Stories:`);
    console.log(`   📦 Batch Size: ${BATCH_SIZE}`);
    console.log(`   🔄 Concurrent API Calls: ${CONCURRENT_LIMIT}`);
    console.log(`   💾 MongoDB Batch Size: ${MONGODB_BATCH_SIZE}`);
    console.log(`   ⏰ Delay Between Batches: ${DELAY_BETWEEN_BATCHES}ms`);
    console.log(`   🌐 API Base: ${TESTLEAF_API_BASE}`);
    console.log(`   📧 User Email: ${USER_EMAIL}`);
    console.log(`   🗄️  Database: ${process.env.DB_NAME}`);
    console.log(`   📦 Collection: ${USER_STORIES_COLLECTION}`);
    
    // Estimated time calculation
    const estimatedTimePerStory = 150; // ms average with concurrency
    const estimatedTotal = (userStories.length * estimatedTimePerStory) / 1000 / 60;
    console.log(`   ⏱️  Estimated Time: ${estimatedTotal.toFixed(1)} minutes\n`);

    let totalCost = 0;
    let totalTokens = 0;
    let totalInserted = 0;
    let totalFailed = 0;
    let processedCount = 0;

    // Process in optimized batches
    for (let i = 0; i < userStories.length; i += BATCH_SIZE) {
      const batch = userStories.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(userStories.length / BATCH_SIZE);
      
      // Generate embeddings concurrently for this batch
      const embeddingPromises = batch.map((userStory, batchIndex) => 
        generateUserStoryEmbedding(userStory, i + batchIndex, userStories.length)
      );

      const embeddingResults = await Promise.allSettled(embeddingPromises);
      
      // Process results and prepare for DB insertion
      const successfulEmbeddings = [];
      let batchCost = 0;
      let batchTokens = 0;

      embeddingResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && !result.value.error) {
          successfulEmbeddings.push(result.value);
          batchCost += result.value.cost;
          batchTokens += result.value.tokens;
        }
        processedCount++;
      });

      // Update progress
      progress.update(processedCount, batchCost, batchTokens);

      // Insert to MongoDB in smaller sub-batches if needed
      let insertedInBatch = 0;
      let failedInBatch = 0;

      if (successfulEmbeddings.length > 0) {
        for (let j = 0; j < successfulEmbeddings.length; j += MONGODB_BATCH_SIZE) {
          const subBatch = successfulEmbeddings.slice(j, j + MONGODB_BATCH_SIZE);
          const insertResult = await insertUserStoriesBatch(collection, subBatch);
          insertedInBatch += insertResult.inserted;
          failedInBatch += insertResult.failed;
        }
      }

      totalCost += batchCost;
      totalTokens += batchTokens;
      totalInserted += insertedInBatch;
      totalFailed += failedInBatch + (batch.length - successfulEmbeddings.length);

      // Only log batch details for first few and last few batches to reduce spam
      if (batchNumber <= 3 || batchNumber >= totalBatches - 2 || batchNumber % 10 === 0) {
        console.log(`📦 User Stories Batch ${batchNumber}/${totalBatches}: ${insertedInBatch} inserted, ${failedInBatch} failed | Cost: $${batchCost.toFixed(6)}`);
      }

      // Smart delay - reduce delay as we process more to speed up
      if (i + BATCH_SIZE < userStories.length) {
        const adaptiveDelay = Math.max(200, DELAY_BETWEEN_BATCHES - (batchNumber * 15));
        await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
      }
    }

    const totalTime = (Date.now() - overallStart) / 1000;
    const rate = userStories.length / totalTime;

    console.log(`\n🎉 USER STORIES BATCH PROCESSING COMPLETE!`);
    console.log(`📊 Final Statistics:`);
    console.log(`   ⏱️  Total Time: ${progress.formatTime(totalTime)}`);
    console.log(`   ⚡ Processing Rate: ${rate.toFixed(1)} stories/second`);
    console.log(`   📝 Total User Stories: ${userStories.length}`);
    console.log(`   ✅ Successfully Processed: ${totalInserted}`);
    console.log(`   ❌ Failed: ${totalFailed}`);
    console.log(`   📈 Success Rate: ${((totalInserted / userStories.length) * 100).toFixed(1)}%`);
    console.log(`   💰 Total Cost: $${totalCost.toFixed(6)}`);
    console.log(`   🔢 Total Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   📊 Average Cost per Story: $${(totalCost / userStories.length).toFixed(8)}`);
    console.log(`   📊 Average Tokens per Story: ${Math.round(totalTokens / userStories.length)}`);
    console.log(`   💡 Speedup vs Sequential: ${((150 * userStories.length / 1000 / 60) / (totalTime / 60)).toFixed(1)}x faster`);

    // Vector index information
    console.log(`\n🔧 Vector Index Information:`);
    console.log(`   📦 Collection: ${USER_STORIES_COLLECTION}`);
    console.log(`   🔍 Index Name: user_stories_vector_index`);
    console.log(`   📐 Dimensions: 1536`);
    console.log(`   📋 Config File: src/config/user-stories-vector-index.json`);
    console.log(`   💡 Remember to create the vector index in MongoDB Atlas if not already created!`);

  } catch (err) {
    if (err.response) {
      console.error("❌ Testleaf API Error:", err.response.status, err.response.data);
    } else {
      console.error("❌ Error:", err.message);
    }
  } finally {
    await client.close();
  }
}

main();
