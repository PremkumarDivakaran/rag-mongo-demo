import { MongoClient } from "mongodb";
import dns from "dns";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";

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
});

// Testleaf API configuration
const TESTLEAF_API_BASE = process.env.TESTLEAF_API_BASE || 'https://api.testleaf.ai';
const USER_EMAIL = process.env.USER_EMAIL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// User Stories specific configuration
const USER_STORIES_COLLECTION = process.env.USER_STORIES_COLLECTION || 'user_stories';
const USER_STORIES_DATA_FILE = "src/data/userstories.json";

/**
 * Create comprehensive input text for user story embedding
 */
function createUserStoryInputText(userStory) {
  const components = Array.isArray(userStory.components) ? userStory.components.join(', ') : '';
  const labels = Array.isArray(userStory.labels) ? userStory.labels.join(', ') : '';
  const fixVersions = Array.isArray(userStory.fixVersions) ? userStory.fixVersions.join(', ') : '';
  
  return `
    Story Key: ${userStory.key || ''}
    Summary: ${userStory.summary || ''}
    Description: ${userStory.description || ''}
    Status: ${userStory.status?.name || ''}
    Priority: ${userStory.priority?.name || ''}
    Assignee: ${userStory.assignee?.displayName || ''}
    Reporter: ${userStory.reporter?.displayName || ''}
    Project: ${userStory.project || ''}
    Epic: ${userStory.epic || ''}
    Story Points: ${userStory.storyPoints || ''}
    Components: ${components}
    Labels: ${labels}
    Fix Versions: ${fixVersions}
    Acceptance Criteria: ${userStory.acceptanceCriteria || ''}
    Business Value: ${userStory.businessValue || ''}
    Dependencies: ${userStory.dependencies || ''}
    Notes: ${userStory.notes || ''}
  `.trim();
}

async function main() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const collection = db.collection(USER_STORIES_COLLECTION);

    // Check if user stories data file exists
    if (!fs.existsSync(USER_STORIES_DATA_FILE)) {
      console.error(`❌ User stories data file not found: ${USER_STORIES_DATA_FILE}`);
      console.log(`💡 Please create user stories data first by:`);
      console.log(`   1. Converting Excel to JSON using excel-to-userstories.js`);
      console.log(`   2. Or fetching from Jira using fetch-jira-stories.js`);
      process.exit(1);
    }

    // Load user stories
    const userStories = JSON.parse(fs.readFileSync(USER_STORIES_DATA_FILE, "utf-8"));

    console.log(`🚀 Processing ${userStories.length} user stories using Testleaf API...`);
    console.log(`⚙️  Configuration:`);
    console.log(`   🌐 API Base: ${TESTLEAF_API_BASE}`);
    console.log(`   📧 User Email: ${USER_EMAIL}`);
    console.log(`   🔑 Auth Token: ${AUTH_TOKEN ? '✅ Provided' : '❌ Missing'}`);
    console.log(`   🗄️  Database: ${process.env.DB_NAME}`);
    console.log(`   📦 Collection: ${USER_STORIES_COLLECTION}`);
    console.log(`   📁 Data File: ${USER_STORIES_DATA_FILE}`);
    console.log(``);

    let totalCost = 0;
    let totalTokens = 0;
    let processedCount = 0;
    let errorCount = 0;

    for (const userStory of userStories) {
      const storyKey = userStory.key || `US-${processedCount + 1}`;
      const storySummary = userStory.summary || 'Untitled Story';
      
      console.log(`📝 Processing [${processedCount + 1}/${userStories.length}]: ${storyKey} - ${storySummary.substring(0, 50)}...`);
      
      try {
        // Create comprehensive input text for embedding
        const inputText = createUserStoryInputText(userStory);
        
        console.log(`📄 Input text length: ${inputText.length} characters`);
        
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
        console.log(`   📊 Usage Details:`, embeddingResponse.data.usage);

        totalCost += cost;
        totalTokens += tokens;

        // Add embedding and metadata to user story
        const doc = {
          ...userStory,
          embedding: vector,
          createdAt: new Date(),
          embeddingMetadata: {
            model: embeddingResponse.data.model,
            cost: cost,
            tokens: tokens,
            apiSource: 'testleaf',
            inputTextLength: inputText.length,
            generatedAt: new Date().toISOString()
          },
          // Additional metadata for search and filtering
          searchableText: inputText,
          lastEmbeddingUpdate: new Date()
        };

        console.log(`💾 Inserting into MongoDB...`);
        const result = await collection.insertOne(doc);
        console.log(`✅ Successfully Inserted:`);
        console.log(`   🆔 Story Key: ${storyKey}`);
        console.log(`   📋 Summary: ${storySummary.substring(0, 50)}...`);
        console.log(`   💰 Cost: $${cost.toFixed(6)}`);
        console.log(`   🔢 Tokens: ${tokens}`);
        console.log(`   🗃️  Mongo ID: ${result.insertedId}`);
        console.log(`   📊 Document Size: ${JSON.stringify(doc).length} bytes`);
        
        processedCount++;
        
        // Small delay to avoid overwhelming the API
        console.log(`⏸️  Waiting 150ms before next request...\n`);
        await new Promise(resolve => setTimeout(resolve, 150));
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing ${storyKey}:`);
        
        if (error.response) {
          console.error(`   🌐 HTTP Status: ${error.response.status}`);
          console.error(`   📋 Response Data:`, error.response.data);
          console.error(`   🔗 Request URL: ${error.config?.url || 'Unknown'}`);
          console.error(`   📝 Request Method: ${error.config?.method || 'Unknown'}`);
        } else if (error.request) {
          console.error(`   📡 No response received from server`);
          console.error(`   🔗 Request URL: ${TESTLEAF_API_BASE}/embedding/text/${USER_EMAIL}`);
          console.error(`   ⏰ Possible timeout or network issue`);
        } else {
          console.error(`   💥 Error Message: ${error.message}`);
          console.error(`   📚 Error Stack:`, error.stack);
        }
        
        // Continue with next user story instead of failing completely
        console.log(`⏭️  Skipping to next user story...\n`);
        continue;
      }
    }

    console.log(`\n🎉 User Stories Processing Complete!`);
    console.log(`📊 Final Statistics:`);
    console.log(`   📝 Total User Stories: ${userStories.length}`);
    console.log(`   ✅ Successfully Processed: ${processedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📈 Success Rate: ${((processedCount / userStories.length) * 100).toFixed(1)}%`);
    console.log(`   💰 Total Cost: $${totalCost.toFixed(6)}`);
    console.log(`   🔢 Total Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   📊 Average Cost per Story: $${(totalCost / userStories.length).toFixed(8)}`);
    console.log(`   📊 Average Tokens per Story: ${Math.round(totalTokens / userStories.length)}`);

    // Create vector index if it doesn't exist
    console.log(`\n🔧 Vector Index Information:`);
    console.log(`   📦 Collection: ${USER_STORIES_COLLECTION}`);
    console.log(`   🔍 Index Name: user_stories_vector_index`);
    console.log(`   📐 Dimensions: 1536`);
    console.log(`   📋 Config File: src/config/user-stories-vector-index.json`);
    console.log(`   💡 Remember to create the vector index in MongoDB Atlas if not already created!`);

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
