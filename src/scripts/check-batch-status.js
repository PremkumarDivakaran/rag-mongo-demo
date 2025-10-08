import OpenAI from "openai";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function checkBatchStatus() {
  try {
    if (!fs.existsSync('batch-info.json')) {
      console.error("❌ batch-info.json not found. Create a batch first!");
      process.exit(1);
    }

    const batchInfo = JSON.parse(fs.readFileSync('batch-info.json', 'utf-8'));
    console.log(`🔍 Checking batch: ${batchInfo.batchId}\n`);

    const batch = await openai.batches.retrieve(batchInfo.batchId);

    console.log(`📊 Batch Status Report:`);
    console.log(`   🆔 Batch ID: ${batch.id}`);
    console.log(`   📝 Status: ${batch.status}`);
    console.log(`   📦 Total requests: ${batch.request_counts.total}`);
    console.log(`   ✅ Completed: ${batch.request_counts.completed}`);
    console.log(`   ❌ Failed: ${batch.request_counts.failed}`);
    console.log(`   ⏳ Created: ${new Date(batch.created_at * 1000).toLocaleString()}`);
    
    if (batch.completed_at) {
      console.log(`   ✅ Completed: ${new Date(batch.completed_at * 1000).toLocaleString()}`);
      const duration = (batch.completed_at - batch.created_at) / 60;
      console.log(`   ⏱️  Duration: ${duration.toFixed(1)} minutes`);
    }

    if (batch.status === 'completed') {
      console.log(`\n🎉 Batch is complete!`);
      console.log(`📥 Output file: ${batch.output_file_id}`);
      console.log(`\n📋 Next step:`);
      console.log(`   node src/scripts/download-batch-results.js`);
    } else if (batch.status === 'in_progress') {
      const progress = (batch.request_counts.completed / batch.request_counts.total * 100).toFixed(1);
      console.log(`\n⏳ Batch is processing... ${progress}% complete`);
      console.log(`   Check again later`);
    } else if (batch.status === 'validating') {
      console.log(`\n🔍 Batch is being validated...`);
    } else if (batch.status === 'failed') {
      console.log(`\n❌ Batch failed!`);
      if (batch.errors) {
        console.log(`   Errors:`, batch.errors);
      }
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

checkBatchStatus();
