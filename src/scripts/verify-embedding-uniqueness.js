import { MongoClient } from "mongodb";
import dns from "dns";
import dotenv from "dotenv";

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const client = new MongoClient(process.env.MONGODB_URI);

async function verifyEmbeddingUniqueness() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    console.log("🔍 VERIFYING EMBEDDING UNIQUENESS\n");
    console.log("=" * 70);

    // 1. Check total count
    const totalCount = await collection.countDocuments({});
    const withEmbedding = await collection.countDocuments({ embedding: { $exists: true } });
    
    console.log(`📊 Database Statistics:`);
    console.log(`   Total documents: ${totalCount}`);
    console.log(`   Documents with embeddings: ${withEmbedding}`);
    console.log(`   Documents without embeddings: ${totalCount - withEmbedding}\n`);

    if (withEmbedding === 0) {
      console.log("❌ No embeddings found in database!");
      return;
    }

    // 2. Sample random embeddings for detailed check
    console.log("🔬 Sampling 20 random embeddings for detailed analysis...\n");
    
    const randomSample = await collection.aggregate([
      { $match: { embedding: { $exists: true } } },
      { $sample: { size: 20 } },
      { $project: { 
          id: 1, 
          title: 1,
          embedding: 1,
          embeddingMetadata: 1
        } 
      }
    ]).toArray();

    // Create a map to track embeddings
    const embeddingMap = new Map();
    const embeddingHashes = new Set();
    let duplicateCount = 0;

    console.log("📋 Sample Embeddings Analysis:");
    console.log("-" * 70);

    for (let i = 0; i < randomSample.length; i++) {
      const doc = randomSample[i];
      const embedding = doc.embedding;
      
      // Create a hash of first 10 values for quick comparison
      const embeddingSignature = embedding.slice(0, 10).map(v => v.toFixed(6)).join(',');
      const fullHash = JSON.stringify(embedding);
      
      console.log(`\n${i + 1}. ${doc.id || 'NO_ID'}: ${doc.title?.substring(0, 40) || 'No title'}...`);
      console.log(`   First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(6)).join(', ')}]`);
      console.log(`   Last 5 values:  [${embedding.slice(-5).map(v => v.toFixed(6)).join(', ')}]`);
      console.log(`   Vector length: ${embedding.length}`);
      console.log(`   Vector sum: ${embedding.reduce((a, b) => a + b, 0).toFixed(6)}`);
      console.log(`   API Source: ${doc.embeddingMetadata?.apiSource || 'unknown'}`);
      
      // Check for duplicates
      if (embeddingHashes.has(fullHash)) {
        console.log(`   ❌ DUPLICATE! Same as document: "${embeddingMap.get(fullHash)}"`);
        duplicateCount++;
      } else {
        embeddingHashes.add(fullHash);
        embeddingMap.set(fullHash, doc.title || doc.id);
        console.log(`   ✅ UNIQUE`);
      }
    }

    console.log("\n" + "=" * 70);
    console.log("📈 SAMPLE ANALYSIS RESULTS:");
    console.log(`   Documents sampled: ${randomSample.length}`);
    console.log(`   Unique embeddings: ${embeddingHashes.size}`);
    console.log(`   Duplicate embeddings: ${duplicateCount}`);

    // 3. Statistical analysis
    console.log("\n" + "=" * 70);
    console.log("📊 STATISTICAL ANALYSIS:\n");

    // Check if embeddings are all zeros or all same value
    const firstDoc = randomSample[0];
    if (firstDoc && firstDoc.embedding) {
      const allZeros = firstDoc.embedding.every(v => v === 0);
      const allSame = firstDoc.embedding.every(v => v === firstDoc.embedding[0]);
      
      if (allZeros) {
        console.log("❌ CRITICAL: Embeddings are all zeros!");
      } else if (allSame) {
        console.log("❌ CRITICAL: All values in embedding are identical!");
      } else {
        console.log("✅ Embeddings contain varied values (good sign)");
      }

      // Calculate statistics
      const embedding = firstDoc.embedding;
      const sum = embedding.reduce((a, b) => a + b, 0);
      const mean = sum / embedding.length;
      const variance = embedding.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / embedding.length;
      const stdDev = Math.sqrt(variance);
      const min = Math.min(...embedding);
      const max = Math.max(...embedding);

      console.log(`\n📐 First Sample Vector Statistics:`);
      console.log(`   Mean: ${mean.toFixed(6)}`);
      console.log(`   Std Dev: ${stdDev.toFixed(6)}`);
      console.log(`   Min: ${min.toFixed(6)}`);
      console.log(`   Max: ${max.toFixed(6)}`);
      console.log(`   Range: ${(max - min).toFixed(6)}`);
    }

    // 4. Compare first and last embeddings
    if (randomSample.length >= 2) {
      console.log("\n" + "=" * 70);
      console.log("🔍 COMPARING DIFFERENT EMBEDDINGS:\n");

      const doc1 = randomSample[0];
      const doc2 = randomSample[randomSample.length - 1];

      console.log(`Document 1: ${doc1.id} - ${doc1.title?.substring(0, 40)}`);
      console.log(`   First 5: [${doc1.embedding.slice(0, 5).map(v => v.toFixed(6)).join(', ')}]`);
      
      console.log(`\nDocument 2: ${doc2.id} - ${doc2.title?.substring(0, 40)}`);
      console.log(`   First 5: [${doc2.embedding.slice(0, 5).map(v => v.toFixed(6)).join(', ')}]`);

      // Calculate cosine similarity
      const dotProduct = doc1.embedding.reduce((sum, val, i) => sum + val * doc2.embedding[i], 0);
      const mag1 = Math.sqrt(doc1.embedding.reduce((sum, val) => sum + val * val, 0));
      const mag2 = Math.sqrt(doc2.embedding.reduce((sum, val) => sum + val * val, 0));
      const cosineSimilarity = dotProduct / (mag1 * mag2);

      console.log(`\n📏 Cosine Similarity: ${cosineSimilarity.toFixed(6)}`);
      
      if (cosineSimilarity > 0.99) {
        console.log("⚠️  WARNING: Very high similarity - might be duplicates!");
      } else if (cosineSimilarity === 1.0) {
        console.log("❌ CRITICAL: Embeddings are identical!");
      } else {
        console.log("✅ Embeddings are different (expected)");
      }
    }

    // 5. Check for completely identical embeddings across ALL documents
    console.log("\n" + "=" * 70);
    console.log("🔍 CHECKING FOR GLOBAL DUPLICATES (this may take a moment)...\n");

    // Sample 100 documents to check if they're all the same
    const largeSample = await collection.aggregate([
      { $match: { embedding: { $exists: true } } },
      { $sample: { size: 100 } },
      { $project: { id: 1, title: 1, embedding: 1 } }
    ]).toArray();

    if (largeSample.length > 0) {
      const referenceEmbedding = JSON.stringify(largeSample[0].embedding);
      let identicalCount = 0;

      for (const doc of largeSample) {
        if (JSON.stringify(doc.embedding) === referenceEmbedding) {
          identicalCount++;
        }
      }

      console.log(`📊 Large Sample Check (100 documents):`);
      console.log(`   Total sampled: ${largeSample.length}`);
      console.log(`   Identical to first: ${identicalCount}`);
      console.log(`   Unique: ${largeSample.length - identicalCount}`);

      if (identicalCount === largeSample.length) {
        console.log("\n❌ DISASTER: ALL EMBEDDINGS ARE IDENTICAL!");
        console.log("   This is the same issue you had before.");
        console.log("   The embedding generation process is broken.");
        console.log("\n🔧 RECOMMENDED ACTION:");
        console.log("   1. Delete all documents: node src/scripts/delete-all-documents.js");
        console.log("   2. Fix the embedding script");
        console.log("   3. Re-run with proper input text variation");
      } else if (identicalCount > 10) {
        console.log(`\n⚠️  WARNING: ${identicalCount} documents have identical embeddings!`);
        console.log("   This is concerning and needs investigation.");
      } else {
        console.log("\n✅ EXCELLENT: Embeddings are unique across the sample!");
        console.log("   Your embeddings appear to be properly generated.");
      }
    }

    // 6. Final verdict
    console.log("\n" + "=" * 70);
    console.log("🎯 FINAL VERDICT:\n");

    if (duplicateCount === 0 && randomSample.length > 0) {
      console.log("✅ PASSED: Sample embeddings are all unique");
    } else if (duplicateCount > 0) {
      console.log(`⚠️  WARNING: Found ${duplicateCount} duplicate(s) in sample`);
    }

    if (embeddingHashes.size === randomSample.length) {
      console.log("✅ PASSED: No duplicate embeddings detected in sample");
    }

    const uniquenessPercentage = (embeddingHashes.size / randomSample.length * 100).toFixed(1);
    console.log(`\n📈 Uniqueness Score: ${uniquenessPercentage}%`);

    if (uniquenessPercentage === "100.0") {
      console.log("\n🎉 GREAT NEWS: Your embeddings appear to be unique!");
      console.log("   Each testcase has a different embedding vector.");
      console.log("   Vector search should work correctly.");
    } else {
      console.log("\n⚠️  CONCERN: Some embeddings may be duplicated.");
      console.log("   This could affect search quality.");
    }

  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await client.close();
  }
}

verifyEmbeddingUniqueness();
