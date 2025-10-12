import { MongoClient } from "mongodb";
import dns from "dns";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
});

// Testleaf API configuration
const TESTLEAF_API_BASE = process.env.TESTLEAF_API_BASE || 'https://api.testleaf.ai';
const USER_EMAIL = process.env.USER_EMAIL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;


/**
 * Create comprehensive text representation of a user story for embedding
 * @param {Object} story - User story object from Jira
 * @returns {string} Formatted text for embedding
 */
function createUserStoryEmbeddingText(story) {
  const assigneeName = story.assignee ? story.assignee.displayName : 'Unassigned';
  const reporterName = story.reporter ? story.reporter.displayName : 'Unknown';
  const components = story.components.length > 0 ? story.components.join(', ') : 'None';
  const labels = story.labels.length > 0 ? story.labels.join(', ') : 'None';
  const fixVersions = story.fixVersions.length > 0 ? story.fixVersions.join(', ') : 'None';
  const storyPoints = story.storyPoints || 'Not estimated';

  return `
Jira Story: ${story.key}
Title: ${story.summary}
Description: ${story.description}
Status: ${story.status.name} (${story.status.category})
Priority: ${story.priority.name}
Assignee: ${assigneeName}
Reporter: ${reporterName}
Story Points: ${storyPoints}
Components: ${components}
Labels: ${labels}
Fix Versions: ${fixVersions}
Created: ${new Date(story.created).toLocaleDateString()}
Updated: ${new Date(story.updated).toLocaleDateString()}
URL: ${story.url}
  `.trim();
}

async function main() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const collection = db.collection(process.env.USER_STORIES_COLLECTION_NAME);

    // Find and load the latest Jira stories file
    const jiraData =  JSON.parse(fs.readFileSync("src/data/jira-user-stories.json", "utf-8"));
    const userStories = jiraData.userStories;

    console.log(`🚀 Processing ${userStories.length} Jira user stories using Testleaf API...`);
    console.log(`⚙️  Configuration:`);
    console.log(`   🌐 API Base: ${TESTLEAF_API_BASE}`);
    console.log(`   📧 User Email: ${USER_EMAIL}`);
    console.log(`   🔑 Auth Token: ${AUTH_TOKEN ? '✅ Provided' : '❌ Missing'}`);
    console.log(`   🗄️  Database: ${process.env.DB_NAME}`);
    console.log(`   📦 Collection: ${process.env.USER_STORIES_COLLECTION_NAME}`);
    console.log(`   📊 Jira Project: ${jiraData.metadata.projectKey}`);
    console.log(`   📅 Data Fetched: ${new Date(jiraData.metadata.fetchedAt).toLocaleString()}`);
    console.log(``);

    let totalCost = 0;
    let totalTokens = 0;
    let successCount = 0;
    let errorCount = 0;

    // Clear existing user stories for this project (optional)
    console.log(`🧹 Clearing existing user stories for project ${jiraData.metadata.projectKey}...`);
    const deleteResult = await collection.deleteMany({
      'jiraMetadata.projectKey': jiraData.metadata.projectKey
    });
    console.log(`🗑️  Deleted ${deleteResult.deletedCount} existing stories\n`);

    for (const [index, story] of userStories.entries()) {
      console.log(`📝 Processing ${index + 1}/${userStories.length}: ${story.key} - ${story.summary.substring(0, 50)}...`);
      
      try {
        const inputText = createUserStoryEmbeddingText(story);
        
        // Generate embeddings using testleaf API
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
            }
          }
        );

        console.log(`📡 Server Response Received:`);
        console.log(`   📊 Status: ${embeddingResponse.status}`);
        console.log(`   📋 Response Status: ${embeddingResponse.data.status}`);
        console.log(`   💬 Message: ${embeddingResponse.data.message || 'No message'}`);
        
        if (embeddingResponse.data.status !== 200) {
          console.error(`❌ API Error Response:`, embeddingResponse.data);
          throw new Error(`Testleaf API error: ${embeddingResponse.data.message}`);
        }

        const vector = embeddingResponse.data.data[0].embedding;
        const cost = embeddingResponse.data.cost || 0;
        const tokens = embeddingResponse.data.usage?.total_tokens || 0;
        
        console.log(`✅ Embedding Generated Successfully:`);
        console.log(`   🤖 Model Used: ${embeddingResponse.data.model}`);
        console.log(`   💰 Cost: $${cost.toFixed(6)}`);
        console.log(`   🔢 Tokens Used: ${tokens}`);
        console.log(`   📐 Vector Dimensions: ${vector?.length || 'Unknown'}`);

        totalCost += cost;
        totalTokens += tokens;

        // Create document with embedding and metadata
        const doc = {
          ...story,
          embedding: vector,
          createdAt: new Date(),
          embeddingMetadata: {
            model: embeddingResponse.data.model,
            cost: cost,
            tokens: tokens,
            apiSource: 'testleaf',
            inputTextLength: inputText.length
          },
          jiraMetadata: {
            projectKey: jiraData.metadata.projectKey,
            jiraBaseUrl: jiraData.metadata.jiraBaseUrl,
            dataFetchedAt: jiraData.metadata.fetchedAt,
            embeddingCreatedAt: new Date().toISOString()
          },
          searchableText: inputText // Store the full text for reference
        };

        console.log(`💾 Inserting into MongoDB...`);
        const result = await collection.insertOne(doc);
        
        successCount++;
        console.log(`✅ Successfully Inserted:`);
        console.log(`   🎫 Jira Key: ${story.key}`);
        console.log(`   💰 Cost: $${cost.toFixed(6)}`);
        console.log(`   🔢 Tokens: ${tokens}`);
        console.log(`   🗃️  Mongo ID: ${result.insertedId}`);
        console.log(`   📊 Document Size: ${JSON.stringify(doc).length} bytes`);
        
        // Small delay to avoid overwhelming the API
        console.log(`⏸️  Waiting 100ms before next request...\n`);
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing ${story.key}:`);
        
        if (error.response) {
          console.error(`   🌐 HTTP Status: ${error.response.status}`);
          console.error(`   📋 Response Data:`, error.response.data);
          console.error(`   🔗 Request URL: ${error.config?.url || 'Unknown'}`);
        } else if (error.request) {
          console.error(`   📡 No response received from server`);
          console.error(`   🔗 Request URL: ${TESTLEAF_API_BASE}/embedding/text/${USER_EMAIL}`);
          console.error(`   ⏰ Possible timeout or network issue`);
        } else {
          console.error(`   💥 Error Message: ${error.message}`);
        }
        
        // Continue with next story instead of failing completely
        console.log(`⏭️  Skipping to next user story...\n`);
        continue;
      }
    }

    console.log(`\n🎉 Processing complete!`);
    console.log(`📊 Summary:`);
    console.log(`   ✅ Successful: ${successCount}/${userStories.length}`);
    console.log(`   ❌ Errors: ${errorCount}/${userStories.length}`);
    console.log(`   💰 Total Cost: $${totalCost.toFixed(6)}`);
    console.log(`   🔢 Total Tokens: ${totalTokens}`);
    console.log(`   📊 Average Cost per Story: $${successCount > 0 ? (totalCost / successCount).toFixed(6) : '0'}`);
    console.log(`   📦 Collection: ${process.env.USER_STORIES_COLLECTION_NAME}`);
    console.log(`   🎯 Project: ${jiraData.metadata.projectKey}`);

    if (successCount > 0) {
      console.log(`\n📋 Next Steps:`);
      console.log(`   1. Create vector search index in MongoDB Atlas`);
      console.log(`   2. Use index name: ${process.env.USER_STORIES_VECTOR_INDEX_NAME}`);
      console.log(`   3. See the vector index configuration in the generated file`);
    }

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