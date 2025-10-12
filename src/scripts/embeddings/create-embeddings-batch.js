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

// BATCH PROCESSING CONFIGURATION - Optimized for Testleaf Batch API
const BATCH_SIZE = 100; // Send 100 batches
const CONCURRENT_LIMIT = 5; // Max 5 concurrent batch API calls (fewer but larger requests)
const DELAY_BETWEEN_BATCHES = 1000; // 1000ms delay between batches (batch calls take longer)
const MONGODB_BATCH_SIZE = 200; // Insert 200 documents at once

// Create limiters for different operations
const embeddingLimit = pLimit(CONCURRENT_LIMIT);
const dbLimit = pLimit(3); // Limit DB operations

/**
 * Generate embeddings for a batch of testcases using Testleaf Batch API
 */
async function generateBatchEmbeddings(testcaseBatch, batchNumber, totalBatches, maxRetries = 3) {
  return embeddingLimit(async () => {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Prepare input texts for batch processing
        const inputs = testcaseBatch.map(testcase => `
          ID: ${testcase.id}
          Module: ${testcase.module}
          Title: ${testcase.title}
          Description: ${testcase.description}
          Steps: ${testcase.steps}
          Expected Result: ${testcase.expectedResults}
        `.trim());
        
        console.log(`🚀 [Batch ${batchNumber}/${totalBatches}] Processing ${testcaseBatch.length} testcases...`);
        
        // Use Testleaf Batch API endpoint
        const embeddingResponse = await axios.post(
          `${TESTLEAF_API_BASE}/embedding/batch/${USER_EMAIL}`,
          {
            inputs: inputs,
            model: "text-embedding-3-small"
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(AUTH_TOKEN && { 'Authorization': `Bearer ${AUTH_TOKEN}` })
            },
            timeout: 300000 // Longer timeout for batch requests
          }
        );

        if (embeddingResponse.data.status !== 200) {
          throw new Error(`Batch API error: ${embeddingResponse.data.message}`);
        }

        const embeddings = embeddingResponse.data.data;
        const totalCost = embeddingResponse.data.cost || 0;
        const totalTokens = embeddingResponse.data.usage?.total_tokens || 0;
        const model = embeddingResponse.data.model;
        
        // Map embeddings back to testcases
        const results = testcaseBatch.map((testcase, index) => ({
          testcase,
          embedding: embeddings[index].embedding,
          cost: totalCost / testcaseBatch.length, // Distribute cost evenly
          tokens: Math.round(totalTokens / testcaseBatch.length), // Distribute tokens evenly
          metadata: {
            model: model,
            cost: totalCost / testcaseBatch.length,
            tokens: Math.round(totalTokens / testcaseBatch.length),
            apiSource: 'testleaf-batch',
            batchNumber: batchNumber,
            createdAt: new Date()
          }
        }));
        
        console.log(`✅ [Batch ${batchNumber}/${totalBatches}] Success! Cost: $${totalCost.toFixed(6)} | Tokens: ${totalTokens}`);
        
        return {
          success: true,
          results: results,
          totalCost: totalCost,
          totalTokens: totalTokens,
          batchSize: testcaseBatch.length
        };

      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`⚠️ [Batch ${batchNumber}/${totalBatches}] Retry ${attempt}/${maxRetries}: ${error.message}`);
          console.log(`   Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    console.error(`❌ [Batch ${batchNumber}/${totalBatches}] Final failure: ${lastError.message}`);
    return {
      success: false,
      error: lastError.message,
      results: testcaseBatch.map(testcase => ({
        testcase,
        error: lastError.message,
        cost: 0,
        tokens: 0
      })),
      totalCost: 0,
      totalTokens: 0,
      batchSize: testcaseBatch.length
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

    console.log(`🚀 TESTLEAF BATCH API PROCESSING: ${testcases.length} test cases`);
    console.log(`⚡ Using Testleaf Batch Embedding API for Maximum Efficiency!`);
    console.log(`⚙️  Configuration for Batch API:`);
    console.log(`   📦 Batch Size: ${BATCH_SIZE} testcases per API call`);
    console.log(`   🔄 Concurrent Batch Calls: ${CONCURRENT_LIMIT}`);
    console.log(`   💾 MongoDB Batch Size: ${MONGODB_BATCH_SIZE}`);
    console.log(`   ⏰ Delay Between Batch Groups: ${DELAY_BETWEEN_BATCHES}ms`);
    console.log(`   🌐 API Endpoint: ${TESTLEAF_API_BASE}/embedding/batch/${USER_EMAIL}`);
    console.log(`   📧 User Email: ${USER_EMAIL}`);
    console.log(`   🗄️  Database: ${process.env.DB_NAME}`);
    console.log(`   📦 Collection: ${process.env.COLLECTION_NAME}`);
    
    // Create batches for concurrent processing
    const batches = [];
    for (let i = 0; i < testcases.length; i += BATCH_SIZE) {
      batches.push({
        testcases: testcases.slice(i, i + BATCH_SIZE),
        batchNumber: Math.floor(i / BATCH_SIZE) + 1
      });
    }
    
    const totalBatches = batches.length;
    
    // Estimated time calculation for batch processing
    const batchGroupsCount = Math.ceil(totalBatches / CONCURRENT_LIMIT);
    const estimatedTimePerBatch = 3; // seconds average for batch API call
    const estimatedTotal = (batchGroupsCount * estimatedTimePerBatch + (batchGroupsCount - 1) * DELAY_BETWEEN_BATCHES / 1000) / 60;
    console.log(`   📊 Total Batches: ${totalBatches}`);
    console.log(`   🏃 Batch Groups: ${batchGroupsCount}`);
    console.log(`   ⏱️  Estimated Time: ${estimatedTotal.toFixed(1)} minutes (Much faster with batch API!)\n`);

    let totalCost = 0;
    let totalTokens = 0;
    let totalInserted = 0;
    let totalFailed = 0;
    let processedCount = 0;
    console.log(`📦 Created ${totalBatches} batches of ~${BATCH_SIZE} testcases each\n`);

    // Process batches with concurrency control
    for (let i = 0; i < batches.length; i += CONCURRENT_LIMIT) {
      const concurrentBatches = batches.slice(i, i + CONCURRENT_LIMIT);
      
      // Process multiple batches concurrently
      const batchPromises = concurrentBatches.map(batch => 
        generateBatchEmbeddings(batch.testcases, batch.batchNumber, totalBatches)
      );

      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process results from concurrent batches
      for (const batchResult of batchResults) {
        if (batchResult.status === 'fulfilled') {
          const result = batchResult.value;
          
          if (result.success) {
            // Update progress tracking
            processedCount += result.batchSize;
            totalCost += result.totalCost;
            totalTokens += result.totalTokens;
            progress.update(processedCount, result.totalCost, result.totalTokens);

            // Insert successful embeddings to MongoDB
            const successfulEmbeddings = result.results.filter(item => !item.error);
            
            if (successfulEmbeddings.length > 0) {
              // Insert in sub-batches if needed
              for (let j = 0; j < successfulEmbeddings.length; j += MONGODB_BATCH_SIZE) {
                const subBatch = successfulEmbeddings.slice(j, j + MONGODB_BATCH_SIZE);
                const insertResult = await insertTestcasesBatch(collection, subBatch);
                totalInserted += insertResult.inserted;
                totalFailed += insertResult.failed;
              }
            }
            
            totalFailed += (result.batchSize - successfulEmbeddings.length);
          } else {
            // Handle failed batch
            processedCount += result.batchSize;
            totalFailed += result.batchSize;
            progress.update(processedCount, 0, 0);
            console.error(`❌ Batch failed: ${result.error}`);
          }
        } else {
          console.error(`❌ Batch promise rejected:`, batchResult.reason);
        }
      }

      // Delay between concurrent batch groups
      if (i + CONCURRENT_LIMIT < batches.length) {
        console.log(`⏸️  Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch group...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
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
    console.log(`   🚀 Batch API Efficiency: ${((testcases.length / totalBatches) * CONCURRENT_LIMIT).toFixed(1)} testcases processed per API call group`);

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
