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

// BATCH PROCESSING CONFIGURATION - Optimized for 6000+ testcases
const BATCH_SIZE = 50; // Process 50 testcases at once (larger batches for many records)
const CONCURRENT_LIMIT = 10; // Max 10 concurrent API calls (optimized for speed)
const DELAY_BETWEEN_BATCHES = 500; // 500ms delay between batches
const MONGODB_BATCH_SIZE = 100; // Insert 100 documents at once

// Create limiters for different operations
const embeddingLimit = pLimit(CONCURRENT_LIMIT);
const dbLimit = pLimit(3); // Limit DB operations

/**
 * Generate embedding for a single testcase with retry logic
 */
async function generateTestcaseEmbedding(testcase, index, total, maxRetries = 3) {
  return embeddingLimit(async () => {
    const testcaseId = testcase.id || `TC-${index + 1}`;
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const inputText = `
          ID: ${testcase.id}
          Module: ${testcase.module}
          Title: ${testcase.title}
          Description: ${testcase.description}
          Steps: ${testcase.steps}
          Expected Result: ${testcase.expectedResults}
        `;
        
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
        
        // Success - log every 100th item to avoid spam
        if (index % 100 === 0 || index === total - 1) {
          console.log(`✅ [${index + 1}/${total}] ${testcaseId} | Cost: $${cost.toFixed(6)} | Tokens: ${tokens}`);
        }

        return {
          testcase,
          embedding: vector,
          cost,
          tokens,
          metadata: {
            model: embeddingResponse.data.model,
            cost: cost,
            tokens: tokens,
            apiSource: 'testleaf',
            createdAt: new Date()
          }
        };

      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          console.log(`⚠️ [${index + 1}/${total}] Retry ${attempt}/${maxRetries} for ${testcaseId}: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        }
      }
    }

    console.error(`❌ [${index + 1}/${total}] Final failure for ${testcaseId}: ${lastError.message}`);
    return {
      testcase,
      error: lastError.message,
      cost: 0,
      tokens: 0
    };
  });
}

/**
 * Optimized batch MongoDB insertion
 */
async function insertTestcasesBatch(collection, batch) {
  return dbLimit(async () => {
    if (batch.length === 0) return { inserted: 0, failed: 0 };

    const documents = batch
      .filter(item => !item.error)
      .map(item => ({
        ...item.testcase,
        embedding: item.embedding,
        createdAt: new Date(),
        embeddingMetadata: item.metadata
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
      console.error(`❌ Batch insert failed:`, error.message);
      return { inserted: 0, failed: batch.length };
    }
  });
}

/**
 * Progress tracking with ETA calculation
 */
class ProgressTracker {
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
      console.log(`📊 Progress: ${this.processed}/${this.total} (${(this.processed/this.total*100).toFixed(1)}%) | Rate: ${rate.toFixed(1)}/sec | ETA: ${this.formatTime(eta)} | Cost: $${this.totalCost.toFixed(6)}`);
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
    const collection = db.collection(process.env.COLLECTION_NAME);

    // Load testcases
    const testcases = JSON.parse(fs.readFileSync("src/data/testcases.json", "utf-8"));
    const progress = new ProgressTracker(testcases.length);

    console.log(`🚀 BATCH PROCESSING: ${testcases.length} test cases`);
    console.log(`⚙️  Configuration for Large Dataset:`);
    console.log(`   📦 Batch Size: ${BATCH_SIZE}`);
    console.log(`   🔄 Concurrent API Calls: ${CONCURRENT_LIMIT}`);
    console.log(`   💾 MongoDB Batch Size: ${MONGODB_BATCH_SIZE}`);
    console.log(`   ⏰ Delay Between Batches: ${DELAY_BETWEEN_BATCHES}ms`);
    console.log(`   🌐 API Base: ${TESTLEAF_API_BASE}`);
    console.log(`   📧 User Email: ${USER_EMAIL}`);
    console.log(`   🗄️  Database: ${process.env.DB_NAME}`);
    console.log(`   📦 Collection: ${process.env.COLLECTION_NAME}`);
    
    // Estimated time calculation
    const estimatedTimePerCase = 150; // ms average with concurrency
    const estimatedTotal = (testcases.length * estimatedTimePerCase) / 1000 / 60;
    console.log(`   ⏱️  Estimated Time: ${estimatedTotal.toFixed(1)} minutes\n`);

    let totalCost = 0;
    let totalTokens = 0;
    let totalInserted = 0;
    let totalFailed = 0;
    let processedCount = 0;

    // Process in optimized batches
    for (let i = 0; i < testcases.length; i += BATCH_SIZE) {
      const batch = testcases.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(testcases.length / BATCH_SIZE);
      
      // Generate embeddings concurrently for this batch
      const embeddingPromises = batch.map((testcase, batchIndex) => 
        generateTestcaseEmbedding(testcase, i + batchIndex, testcases.length)
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
          const insertResult = await insertTestcasesBatch(collection, subBatch);
          insertedInBatch += insertResult.inserted;
          failedInBatch += insertResult.failed;
        }
      }

      totalCost += batchCost;
      totalTokens += batchTokens;
      totalInserted += insertedInBatch;
      totalFailed += failedInBatch + (batch.length - successfulEmbeddings.length);

      // Only log batch details for first few and last few batches to reduce spam
      if (batchNumber <= 3 || batchNumber >= totalBatches - 2 || batchNumber % 20 === 0) {
        console.log(`📦 Batch ${batchNumber}/${totalBatches}: ${insertedInBatch} inserted, ${failedInBatch} failed | Cost: $${batchCost.toFixed(6)}`);
      }

      // Smart delay - reduce delay as we process more to speed up
      if (i + BATCH_SIZE < testcases.length) {
        const adaptiveDelay = Math.max(100, DELAY_BETWEEN_BATCHES - (batchNumber * 5));
        await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
      }
    }

    const totalTime = (Date.now() - overallStart) / 1000;
    const rate = testcases.length / totalTime;

    console.log(`\n🎉 BATCH PROCESSING COMPLETE!`);
    console.log(`📊 Final Statistics:`);
    console.log(`   ⏱️  Total Time: ${progress.formatTime(totalTime)}`);
    console.log(`   ⚡ Processing Rate: ${rate.toFixed(1)} testcases/second`);
    console.log(`   📝 Total Test Cases: ${testcases.length}`);
    console.log(`   ✅ Successfully Processed: ${totalInserted}`);
    console.log(`   ❌ Failed: ${totalFailed}`);
    console.log(`   📈 Success Rate: ${((totalInserted / testcases.length) * 100).toFixed(1)}%`);
    console.log(`   💰 Total Cost: $${totalCost.toFixed(6)}`);
    console.log(`   🔢 Total Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   📊 Average Cost per Test Case: $${(totalCost / testcases.length).toFixed(8)}`);
    console.log(`   📊 Average Tokens per Test Case: ${Math.round(totalTokens / testcases.length)}`);
    console.log(`   💡 Speedup vs Sequential: ${((testcases.length * 0.5 / 60) / (totalTime / 60)).toFixed(1)}x faster`);

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
