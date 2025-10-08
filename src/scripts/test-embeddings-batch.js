import { MongoClient } from "mongodb";
import dns from "dns";
import OpenAI from "openai";
import dotenv from "dotenv";
import fs from "fs";
import pLimit from "p-limit";

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  ssl: true,
  tlsAllowInvalidCertificates: true,
  tlsAllowInvalidHostnames: true,
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
  maxPoolSize: 20
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// TEST BATCH - Only process first 10 testcases
const BATCH_SIZE = 10;
const CONCURRENT_LIMIT = 5;
const DELAY_BETWEEN_BATCHES = 500;
const MONGODB_BATCH_SIZE = 10;

const embeddingLimit = pLimit(CONCURRENT_LIMIT);
const dbLimit = pLimit(3);

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
        
        console.log(`\n[${index + 1}/${total}] Processing ${testcaseId}:`);
        console.log(`   Title: ${testcase.title?.substring(0, 50)}...`);
        console.log(`   Input length: ${inputText.length} chars`);
        
        const response = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: inputText,
          encoding_format: "float"
        });

        const embedding = response.data[0].embedding;
        const tokens = response.usage.total_tokens;
        const cost = (tokens / 1000) * 0.00002;
        
        console.log(`   ✅ Tokens: ${tokens} | Cost: $${cost.toFixed(8)}`);
        console.log(`   Embedding: [${embedding.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...]`);

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
        if (error.status === 429) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`   ⚠️  Rate limit hit, waiting ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else if (attempt < maxRetries) {
          console.log(`   ⚠️  Retry ${attempt}/${maxRetries}: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    console.error(`   ❌ Final failure: ${lastError.message}`);
    return {
      testcase,
      error: lastError.message,
      cost: 0,
      tokens: 0
    };
  });
}

async function insertBatch(collection, batch) {
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

async function main() {
  const overallStart = Date.now();
  
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("❌ OPENAI_API_KEY not found in .env file!");
      process.exit(1);
    }

    await mongoClient.connect();
    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    const allTestcases = JSON.parse(fs.readFileSync("src/data/testcases.json", "utf-8"));
    
    // TEST: Only process first 10 testcases
    const testcases = allTestcases.slice(0, 10);

    console.log(`🧪 TEST BATCH PROCESSING: ${testcases.length} test cases (out of ${allTestcases.length} total)`);
    console.log(`⚡ Verifying embeddings will be unique\n`);
    console.log(`⚙️  Configuration:`);
    console.log(`   📦 Batch Size: ${BATCH_SIZE}`);
    console.log(`   🔄 Concurrent API Calls: ${CONCURRENT_LIMIT}`);
    console.log(`   🤖 Model: text-embedding-3-small`);
    console.log(`   🗄️  Database: ${process.env.DB_NAME}`);
    console.log(`   📦 Collection: ${process.env.COLLECTION_NAME}\n`);

    let totalCost = 0;
    let totalTokens = 0;
    let totalInserted = 0;
    let totalFailed = 0;
    let processedCount = 0;

    const embeddingPromises = testcases.map((testcase, index) => 
      generateEmbeddingDirect(testcase, index, testcases.length)
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

    totalCost += batchCost;
    totalTokens += batchTokens;

    // Check for duplicate embeddings in this test batch
    console.log(`\n🔍 Checking for duplicate embeddings...`);
    const embeddingHashes = new Set();
    let duplicates = 0;

    for (const item of successfulEmbeddings) {
      const hash = JSON.stringify(item.embedding);
      if (embeddingHashes.has(hash)) {
        duplicates++;
        console.log(`   ❌ Duplicate found: ${item.testcase.id}`);
      } else {
        embeddingHashes.add(hash);
        console.log(`   ✅ Unique: ${item.testcase.id} - ${item.testcase.title?.substring(0, 40)}`);
      }
    }

    if (duplicates > 0) {
      console.log(`\n❌ FAILED: Found ${duplicates} duplicate embeddings!`);
      console.log(`   DO NOT run the full batch. Fix the issue first.`);
      process.exit(1);
    } else {
      console.log(`\n✅ EXCELLENT: All ${successfulEmbeddings.length} embeddings are unique!`);
    }

    // Insert to MongoDB
    console.log(`\n💾 Inserting test batch to MongoDB...`);
    const insertResult = await insertBatch(collection, successfulEmbeddings);
    totalInserted += insertResult.inserted;
    totalFailed += insertResult.failed + (testcases.length - successfulEmbeddings.length);

    const totalTime = (Date.now() - overallStart) / 1000;

    console.log(`\n🎉 TEST BATCH COMPLETE!`);
    console.log(`📊 Results:`);
    console.log(`   ✅ Successfully Processed: ${totalInserted}`);
    console.log(`   ❌ Failed: ${totalFailed}`);
    console.log(`   💰 Total Cost: $${totalCost.toFixed(6)}`);
    console.log(`   🔢 Total Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   ⏱️  Time: ${totalTime.toFixed(1)}s`);

    if (totalInserted === testcases.length && duplicates === 0) {
      console.log(`\n✅ ALL TESTS PASSED!`);
      console.log(`   👍 Embeddings are unique`);
      console.log(`   👍 All testcases inserted successfully`);
      console.log(`\n📋 Next step:`);
      console.log(`   Run full batch: node src/scripts/create-embeddings-openai-direct.js`);
      console.log(`   Expected time: ~3-5 minutes for 6,354 testcases`);
      console.log(`   Expected cost: ~$0.13`);
    }

  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await mongoClient.close();
  }
}

main();
