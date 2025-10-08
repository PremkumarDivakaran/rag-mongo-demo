import { MongoClient } from "mongodb";
import dns from "dns";
import dotenv from "dotenv";

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const client = new MongoClient(process.env.MONGODB_URI);

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

async function migrateLinkedStories() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const collection = db.collection(process.env.COLLECTION_NAME);

    console.log("🔄 MIGRATING linkedStories FROM STRING TO ARRAY\n");

    // Find all documents where linkedStories is a string
    const docsWithStringLinkedStories = await collection.find({
      linkedStories: { $type: "string" }
    }).toArray();

    console.log(`📊 Found ${docsWithStringLinkedStories.length} documents with string linkedStories`);

    if (docsWithStringLinkedStories.length === 0) {
      console.log("✅ No migration needed! All linkedStories are already arrays.");
      return;
    }

    console.log("\n🔧 Starting migration...\n");

    let successCount = 0;
    let errorCount = 0;

    for (const doc of docsWithStringLinkedStories) {
      try {
        const linkedStoriesArray = parseLinkedStories(doc.linkedStories);
        
        await collection.updateOne(
          { _id: doc._id },
          { $set: { linkedStories: linkedStoriesArray } }
        );

        successCount++;

        // Log progress every 100 documents
        if (successCount % 100 === 0) {
          console.log(`   ✅ Migrated ${successCount}/${docsWithStringLinkedStories.length}...`);
        }

        // Show examples of the first 5 conversions
        if (successCount <= 5) {
          console.log(`   Example ${successCount}:`);
          console.log(`      Before: "${doc.linkedStories}"`);
          console.log(`      After:  [${linkedStoriesArray.map(s => `"${s}"`).join(', ')}]`);
        }

      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error migrating document ${doc._id}: ${error.message}`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("🎉 MIGRATION COMPLETE!\n");
    console.log(`📊 Results:`);
    console.log(`   ✅ Successfully migrated: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📈 Success rate: ${((successCount / docsWithStringLinkedStories.length) * 100).toFixed(1)}%`);

    // Verify the migration
    console.log("\n🔍 Verifying migration...");
    const remainingStringDocs = await collection.countDocuments({
      linkedStories: { $type: "string" }
    });
    const arrayDocs = await collection.countDocuments({
      linkedStories: { $type: "array" }
    });

    console.log(`   📦 Documents with array linkedStories: ${arrayDocs}`);
    console.log(`   📝 Documents with string linkedStories: ${remainingStringDocs}`);

    if (remainingStringDocs === 0) {
      console.log("\n✅ Perfect! All linkedStories are now arrays!");
    } else {
      console.log(`\n⚠️  Warning: ${remainingStringDocs} documents still have string linkedStories`);
    }

    // Show sample of migrated data
    console.log("\n📋 Sample of migrated data:");
    const samples = await collection.find({
      linkedStories: { $type: "array", $ne: [] }
    }).limit(3).toArray();

    samples.forEach((doc, i) => {
      console.log(`\n${i + 1}. ${doc.id || 'NO_ID'}: ${doc.title?.substring(0, 40) || 'No title'}`);
      console.log(`   linkedStories: [${doc.linkedStories.map(s => `"${s}"`).join(', ')}]`);
      console.log(`   Type: ${Array.isArray(doc.linkedStories) ? 'Array ✅' : 'NOT Array ❌'}`);
    });

  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await client.close();
  }
}

migrateLinkedStories();
