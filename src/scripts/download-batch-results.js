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

async function downloadAndImport() {
  try {
    if (!fs.existsSync('batch-info.json')) {
      console.error("❌ batch-info.json not found!");
      process.exit(1);
    }

    const batchInfo = JSON.parse(fs.readFileSync('batch-info.json', 'utf-8'));
    console.log(`📥 Downloading batch results: ${batchInfo.batchId}\n`);

    // Check if batch is complete
    const batch = await openai.batches.retrieve(batchInfo.batchId);
    
    if (batch.status !== 'completed') {
      console.error(`❌ Batch not complete yet. Status: ${batch.status}`);
      console.log(`   Run: node src/scripts/check-batch-status.js`);
      process.exit(1);
    }

    console.log(`✅ Batch is complete!`);
    console.log(`📦 Downloading ${batch.request_counts.completed} results...\n`);

    // Download output file
    const fileResponse = await openai.files.content(batch.output_file_id);
    const fileContents = await fileResponse.text();
    
    // Save raw results
    const resultsFile = `batch-results-${Date.now()}.jsonl`;
    fs.writeFileSync(resultsFile, fileContents);
    console.log(`✅ Downloaded to: ${resultsFile}`);

    // Parse results
    const results = fileContents.split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));

    console.log(`📊 Parsed ${results.length} results`);

    // Load original testcases
    const testcases = JSON.parse(fs.readFileSync("src/data/testcases.json", "utf-8"));
    const testcaseMap = new Map(testcases.map(tc => [tc.id, tc]));

    // Import to MongoDB
    console.log(`\n💾 Importing to MongoDB...`);
    await mongoClient.connect();
    const db = mongoClient.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    let successCount = 0;
    let failureCount = 0;
    let totalCost = 0;
    let totalTokens = 0;

    const documents = [];

    for (const result of results) {
      if (result.response.status_code === 200) {
        const testcase = testcaseMap.get(result.custom_id);
        if (!testcase) {
          console.warn(`⚠️  Testcase not found: ${result.custom_id}`);
          continue;
        }

        const embedding = result.response.body.data[0].embedding;
        const tokens = result.response.body.usage.total_tokens;
        const cost = (tokens / 1000) * 0.00001; // Batch API pricing

        documents.push({
          ...testcase,
          embedding: embedding,
          createdAt: new Date(),
          embeddingMetadata: {
            model: result.response.body.model,
            cost: cost,
            tokens: tokens,
            apiSource: 'openai-batch',
            batchId: batch.id
          }
        });

        totalCost += cost;
        totalTokens += tokens;
        successCount++;

        if (successCount % 1000 === 0) {
          console.log(`   Processed ${successCount}/${results.length}...`);
        }
      } else {
        failureCount++;
        console.error(`❌ Failed: ${result.custom_id} - ${result.response.body.error}`);
      }
    }

    // Bulk insert to MongoDB
    if (documents.length > 0) {
      console.log(`\n📥 Inserting ${documents.length} documents to MongoDB...`);
      const insertResult = await collection.insertMany(documents, { ordered: false });
      console.log(`✅ Inserted ${insertResult.insertedCount} documents`);
    }

    console.log(`\n🎉 BATCH IMPORT COMPLETE!`);
    console.log(`📊 Final Statistics:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failureCount}`);
    console.log(`   💰 Total Cost: $${totalCost.toFixed(6)}`);
    console.log(`   🔢 Total Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   📊 Average Cost: $${(totalCost / successCount).toFixed(8)}`);
    console.log(`   💡 Savings vs Real-time: 50% cheaper!`);

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await mongoClient.close();
  }
}

downloadAndImport();
