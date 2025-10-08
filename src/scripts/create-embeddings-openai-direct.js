import { MongoClient } from "mongodb";
import dns from "dns";
import OpenAI from "openai";
import dotenv from "dotenv";
import fs from "fs";
import pLimit from "p-limit";

dotenv.config();

// Fix DNS resolution issue on macOS by using Google's DNS servers
dns.setServers(['8.8.8.8', '8.8.4.4']);

// Configure MongoDB client
const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  ssl: true,
  tlsAllowInvalidCertificates: true,
  tlsAllowInvalidHostnames: true,
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
  maxPoolSize: 20
});

// Initialize OpenAI client directly
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Add this to your .env file
});

// OPTIMIZED BATCH PROCESSING - OpenAI allows MUCH higher concurrency!
const BATCH_SIZE = 100; // Process 100 testcases at once
const CONCURRENT_LIMIT = 50; // OpenAI allows 50+ concurrent requests!
const DELAY_BETWEEN_BATCHES = 200; // Much shorter delay
const MONGODB_BATCH_SIZE = 200; // Insert 200 documents at once

// Create limiters
const embeddingLimit = pLimit(CONCURRENT_LIMIT);
const dbLimit = pLimit(5);

/**
 * Generate embedding using OpenAI directly (MUCH FASTER!)
 */
async function generateEmbeddingDirect(testcase, index, total, maxRetries = 3) {
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
        `.trim();
        
        // Call OpenAI directly - MUCH FASTER!
        const response = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: inputText,
          encoding_format: "float"
        });

        const embedding = response.data[0].embedding;
        const tokens = response.usage.total_tokens;
        // OpenAI pricing: $0.00002 per 1K tokens for text-embedding-3-small
        const cost = (tokens / 1000) * 0.00002;
        
        // Log every 200th item
        if (index % 200 === 0 || index === total - 1) {
          console.log(`✅ [${index + 1}/${total}] ${testcaseId} | Tokens: ${tokens} | Cost: $${cost.toFixed(8)}`);
        }

        return {
          testcase,
          embedding: embedding,
          cost,
          tokens,
          metadata: {
            model: "text-embedding-3-small",
            cost: cost,
            tokens: tokens,
            apiSource: 'openai-direct',
            createdAt: new Date()
          }
        };

      } catch (error) {
        lastError = error;
        
        // Handle rate limits with exponential backoff
        if (error.status === 429) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`⚠️ [${index + 1}/${total}] Rate limit hit, waiting ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else if (attempt < maxRetries) {
          console.log(`⚠️ [${index + 1}/${total}] Retry ${attempt}/${maxRetries} for ${testcaseId}: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
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
 * Parse comma-separated linkedStories into array
 */
function parseLinkedStories(linkedStories) {
  if (!linkedStories) return [];
  if (Array.isArray(linkedStories)) return linkedStories;
  if (typeof linkedStories === 'string') {
    return linkedStories.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }
  return [];
}

/**
 * Optimized batch MongoDB insertion
 */
async function insertBatch(collection, batch) {
  return dbLimit(async () => {
    if (batch.length === 0) return { inserted: 0, failed: 0 };

    const documents = batch
      .filter(item => !item.error)
      .map(item => ({
        ...item.testcase,
        // Convert linkedStories from string to array
        linkedStories: parseLinkedStories(item.testcase.linkedStories),
        embedding: item.embedding,
        createdAt: new Date(),
        embeddingMetadata: item.metadata
      }));

    if (documents.length === 0) {
      return { inserted: 0, failed: batch.length };
    }

    try {
      const result = await collection.insertMany(documents, { 
        ordered: false,
        writeConcern: { w: 1 }
      });
      
      return { inserted: result.insertedCount, failed: batch.length - documents.length };
    } catch (error) {
      console.error(`❌ Batch insert failed:`, error.message);
      return { inserted: 0, failed: batch.length };
    }
  });
}

/**
 * Progress tracker
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

    if (now - this.lastUpdate > 10000 || this.processed === this.total) {
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
    // Verify OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error("❌ OPENAI_API_KEY not found in .env file!");
      console.log("💡 Add: OPENAI_API_KEY=sk-your-key-here to .env");
      process.exit(1);
    }

    await mongoClient.connect();
    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    const testcases = JSON.parse(fs.readFileSync("src/data/testcases.json", "utf-8"));
    const progress = new ProgressTracker(testcases.length);

    console.log(`🚀 DIRECT OPENAI API BATCH PROCESSING: ${testcases.length} test cases`);
    console.log(`⚡ ULTRA-FAST MODE - Direct OpenAI API calls!`);
    console.log(`⚙️  Configuration:`);
    console.log(`   📦 Batch Size: ${BATCH_SIZE}`);
    console.log(`   🔄 Concurrent API Calls: ${CONCURRENT_LIMIT} (50x faster!)`);
    console.log(`   💾 MongoDB Batch Size: ${MONGODB_BATCH_SIZE}`);
    console.log(`   ⏰ Delay Between Batches: ${DELAY_BETWEEN_BATCHES}ms`);
    console.log(`   🤖 Model: text-embedding-3-small`);
    console.log(`   🗄️  Database: ${process.env.DB_NAME}`);
    console.log(`   📦 Collection: ${process.env.COLLECTION_NAME}`);
    
    const estimatedTimePerCase = 30; // Much faster with direct OpenAI!
    const estimatedTotal = (testcases.length * estimatedTimePerCase) / 1000 / 60;
    console.log(`   ⏱️  Estimated Time: ${estimatedTotal.toFixed(1)} minutes (vs 15+ min with testleaf)\n`);

    let totalCost = 0;
    let totalTokens = 0;
    let totalInserted = 0;
    let totalFailed = 0;
    let processedCount = 0;

    for (let i = 0; i < testcases.length; i += BATCH_SIZE) {
      const batch = testcases.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(testcases.length / BATCH_SIZE);
      
      const embeddingPromises = batch.map((testcase, batchIndex) => 
        generateEmbeddingDirect(testcase, i + batchIndex, testcases.length)
      );

      const embeddingResults = await Promise.allSettled(embeddingPromises);
      
      const successfulEmbeddings = [];
      let batchCost = 0;
      let batchTokens = 0;

      embeddingResults.forEach((result) => {
        if (result.status === 'fulfilled' && !result.value.error) {
          successfulEmbeddings.push(result.value);
          batchCost += result.value.cost;
          batchTokens += result.value.tokens;
        }
        processedCount++;
      });

      progress.update(processedCount, batchCost, batchTokens);

      let insertedInBatch = 0;
      let failedInBatch = 0;

      if (successfulEmbeddings.length > 0) {
        for (let j = 0; j < successfulEmbeddings.length; j += MONGODB_BATCH_SIZE) {
          const subBatch = successfulEmbeddings.slice(j, j + MONGODB_BATCH_SIZE);
          const insertResult = await insertBatch(collection, subBatch);
          insertedInBatch += insertResult.inserted;
          failedInBatch += insertResult.failed;
        }
      }

      totalCost += batchCost;
      totalTokens += batchTokens;
      totalInserted += insertedInBatch;
      totalFailed += failedInBatch + (batch.length - successfulEmbeddings.length);

      if (batchNumber <= 2 || batchNumber >= totalBatches - 1 || batchNumber % 10 === 0) {
        console.log(`📦 Batch ${batchNumber}/${totalBatches}: ${insertedInBatch} inserted | Cost: $${batchCost.toFixed(6)}`);
      }

      if (i + BATCH_SIZE < testcases.length) {
        const adaptiveDelay = Math.max(50, DELAY_BETWEEN_BATCHES - (batchNumber * 2));
        await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
      }
    }

    const totalTime = (Date.now() - overallStart) / 1000;
    const rate = testcases.length / totalTime;

    console.log(`\n🎉 ULTRA-FAST BATCH PROCESSING COMPLETE!`);
    console.log(`📊 Final Statistics:`);
    console.log(`   ⏱️  Total Time: ${progress.formatTime(totalTime)}`);
    console.log(`   ⚡ Processing Rate: ${rate.toFixed(1)} testcases/second`);
    console.log(`   📝 Total Test Cases: ${testcases.length}`);
    console.log(`   ✅ Successfully Processed: ${totalInserted}`);
    console.log(`   ❌ Failed: ${totalFailed}`);
    console.log(`   📈 Success Rate: ${((totalInserted / testcases.length) * 100).toFixed(1)}%`);
    console.log(`   💰 Total Cost: $${totalCost.toFixed(6)}`);
    console.log(`   🔢 Total Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   📊 Average per Test: $${(totalCost / testcases.length).toFixed(8)} | ${Math.round(totalTokens / testcases.length)} tokens`);
    console.log(`   🚀 Speedup vs Testleaf: ${(15 / (totalTime / 60)).toFixed(1)}x faster!`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    if (err.status) console.error(`   HTTP Status: ${err.status}`);
  } finally {
    await mongoClient.close();
  }
}

main();
