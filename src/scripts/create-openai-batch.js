import { MongoClient } from "mongodb";
import dns from "dns";
import OpenAI from "openai";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  ssl: true,
  tlsAllowInvalidCertificates: true,
  tlsAllowInvalidHostnames: true,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * OpenAI Batch API - 50% cheaper but takes 24 hours!
 * Best for: Very large datasets where time isn't critical
 * Pricing: $0.00001 per 1K tokens (vs $0.00002 for real-time API)
 */

async function createBatchFile() {
  try {
    console.log("📦 Creating OpenAI Batch Request...\n");

    const testcases = JSON.parse(fs.readFileSync("src/data/testcases.json", "utf-8"));
    console.log(`📝 Loading ${testcases.length} test cases`);

    // Create JSONL file for batch processing
    const batchRequests = testcases.map((testcase, index) => {
      const inputText = `
        ID: ${testcase.id}
        Module: ${testcase.module}
        Title: ${testcase.title}
        Description: ${testcase.description}
        Steps: ${testcase.steps}
        Expected Result: ${testcase.expectedResults}
      `.trim();

      return {
        custom_id: testcase.id || `TC-${index + 1}`,
        method: "POST",
        url: "/v1/embeddings",
        body: {
          model: "text-embedding-3-small",
          input: inputText,
          encoding_format: "float"
        }
      };
    });

    // Write to JSONL file
    const jsonlContent = batchRequests.map(req => JSON.stringify(req)).join('\n');
    const batchFileName = `batch-embeddings-${Date.now()}.jsonl`;
    fs.writeFileSync(batchFileName, jsonlContent);

    console.log(`✅ Created batch file: ${batchFileName}`);
    console.log(`📊 Size: ${(fs.statSync(batchFileName).size / 1024 / 1024).toFixed(2)} MB`);

    // Upload batch file to OpenAI
    console.log(`\n📤 Uploading to OpenAI...`);
    const file = await openai.files.create({
      file: fs.createReadStream(batchFileName),
      purpose: "batch"
    });

    console.log(`✅ File uploaded: ${file.id}`);

    // Create batch job
    console.log(`\n🚀 Creating batch job...`);
    const batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: "/v1/embeddings",
      completion_window: "24h"
    });

    console.log(`✅ Batch created: ${batch.id}`);
    console.log(`📊 Status: ${batch.status}`);
    console.log(`⏰ Completion window: 24 hours`);
    console.log(`💰 Cost: 50% cheaper than real-time API!`);
    
    // Save batch info
    const batchInfo = {
      batchId: batch.id,
      fileId: file.id,
      fileName: batchFileName,
      testcaseCount: testcases.length,
      createdAt: new Date().toISOString(),
      status: batch.status
    };

    fs.writeFileSync('batch-info.json', JSON.stringify(batchInfo, null, 2));
    console.log(`\n💾 Batch info saved to: batch-info.json`);

    console.log(`\n📋 Next steps:`);
    console.log(`   1. Wait up to 24 hours for batch to complete`);
    console.log(`   2. Check status: node src/scripts/check-batch-status.js`);
    console.log(`   3. Download results: node src/scripts/download-batch-results.js`);
    console.log(`\n🔍 To check status now:`);
    console.log(`   openai.batches.retrieve('${batch.id}')`);

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

createBatchFile();
