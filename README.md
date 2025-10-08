# RAG MongoDB Demo - Enterprise React UI

A comprehensive enterprise-grade React.js UI for managing a RAG (Retrieval-Augmented Generation) pipeline with MongoDB Atlas Vector Search. Features modern design patterns, dark/light mode, responsive layout, and professional data visualization.

## ✨ Enterprise Features

### 🎨 Modern UI/UX
- **Dark/Light Mode Toggle** - System preference detection with manual override
- **Responsive Design** - Adaptive layout for desktop, tablet, and mobile
- **Collapsible Sidebar** - Hamburger menu with icon-only mode
- **Enterprise Color Palette** - Professional deep blue and amber theme
- **Typography Hierarchy** - Consistent font weights and spacing

### 🧭 Advanced Navigation
- **Active Item Highlights** - Bold accent strips and visual feedback
- **Hover & Ripple Effects** - Subtle interactions and Material Design animations
- **Breadcrumb Navigation** - Context awareness in secondary toolbar
- **Tooltips** - Helpful guidance when sidebar is collapsed

### 📊 Professional Components
- **DataGrid Tables** - Sortable, filterable, paginated data display
- **Card-Based Layouts** - Organized information with clear hierarchy
- **Stepper Progress** - Visual workflow indicators
- **Advanced Notifications** - Toast messages with notistack integration
- **Loading States** - Professional progress indicators

## Features

### 🔄 Convert to JSON
- **Smart File Upload** - Drag-and-drop interface with validation
- **Progress Tracking** - Step-by-step conversion workflow
- **Real-time Feedback** - Instant validation and error handling
- **Configurable Processing** - Custom sheet names and column mapping
- **Enterprise Layout** - Professional card-based design

### 📊 Embeddings & Store
- **Advanced File Management** - DataGrid with sorting and filtering
- **Batch Processing** - Select multiple files for embedding creation
- **Real-time Progress** - Live status updates and detailed logs
- **Professional Dashboard** - Card-based action panels
- **Settings Integration** - Configurable embedding parameters

### ⚙️ Settings Management
- **Secure Configuration** - Masked sensitive data with toggle visibility
- **Real-time Updates** - Instant configuration changes
- **Professional Layout** - Card-based environment variable editing
- **Input Validation** - Form validation with helpful error messages
- **Security Indicators** - Clear marking of sensitive fields

### 🔍 Intelligent Search
- **Semantic Search** - AI-powered similarity matching
- **DataGrid Results** - Professional tabular display with sorting
- **Detailed View** - Expandable result cards with full information
- **Search Analytics** - Cost tracking and performance metrics
- **Smart Suggestions** - Built-in search tips and best practices

## Technology Stack

### Frontend
- **React 18** - Modern React with hooks and concurrent features
- **Material-UI (MUI) v5** - Professional component library
- **MUI DataGrid** - Advanced data table with enterprise features
- **Notistack** - Advanced notification system
- **Axios** - HTTP client with interceptors
- **Emotion** - CSS-in-JS styling solution

### Backend
- **Express.js** - RESTful API server
- **MongoDB Atlas** - Cloud database with Vector Search
- **Multer** - File upload middleware
- **CORS** - Cross-origin resource sharing
- **dotenv** - Environment configuration

### External Services
- **TestLeaf API** - AI embedding generation
- **MongoDB Atlas Vector Search** - Semantic similarity search

## Prerequisites

1. **Node.js** (v14 or higher)
2. **MongoDB Atlas** account with Vector Search enabled
3. **TestLeaf API** access credentials

## Installation & Setup

### 1. Clone and Install Dependencies

```bash
# Navigate to the project directory
cd rag-mongo-demo

# Install all dependencies (root + client)
npm install
```

**Note**: The `npm install` command will automatically install both backend and frontend dependencies using a postinstall hook.

### 2. Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
# MongoDB Configuration
MONGODB_URI="your_mongodb_atlas_connection_string"
DB_NAME="db_test_cases"
COLLECTION_NAME="collection_test_cases"
VECTOR_INDEX_NAME="test_cases"

# TestLeaf API Configuration
TESTLEAF_API_BASE="https://api.testleaf.com/ai"
USER_EMAIL="your_email@example.com"
AUTH_TOKEN="your_api_token"

# Server Configuration (optional)
PORT=3001
```

### 3. MongoDB Atlas Setup

1. Create a MongoDB Atlas cluster
2. Create a database and collection as specified in your `.env`
3. Create a Vector Search index named `test_cases` with the following configuration:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    }
  ]
}
```

### 4. Start the Application

```bash
# Start both backend and frontend (recommended)
npm run dev

# Or start them separately:
# Backend only
npm run server

# Frontend only (in another terminal)
npm run client
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001

## Usage Guide

### 1. Convert Excel to JSON

1. Navigate to **Convert to JSON** section
2. Click **Select Excel File** and choose your test case file
3. Enter the sheet name (default: "Testcases")
4. Click **Convert to JSON**
5. The converted file will be saved in the `src/data` folder

**Expected Excel Format:**
- Test Case ID
- Module
- Test Case
- Test Case Description
- Test Steps
- Expected Results

### 2. Create Embeddings

1. Go to **Embeddings & Store** section
2. Click **Refresh** to load available JSON files
3. Select the files you want to process
4. Click **Create Embeddings**
5. Monitor the progress and results

### 3. Configure Settings

1. Access **Settings** section
2. View current environment variables
3. Edit values as needed (sensitive data is masked)
4. Click **Save Changes**
5. Restart the server for changes to take effect

### 4. Search Test Cases

1. Navigate to **Query** section
2. Enter your search query (e.g., "merchant payment validation")
3. Select the number of results to display
4. Click **Search**
5. Review results ranked by similarity score

## API Endpoints

### File Management
- `GET /api/files` - List all JSON files
- `POST /api/upload-excel` - Upload and convert Excel files

### Embeddings
- `POST /api/create-embeddings` - Create embeddings for selected files

### Configuration
- `GET /api/env` - Get environment variables
- `POST /api/env` - Update environment variables

### Search
- `POST /api/search` - Semantic search through test cases

### Health
- `GET /api/health` - Server health check

## File Structure

```
rag-mongo-demo/
├── client/                     # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── ConvertToJson.js
│   │   │   ├── EmbeddingsStore.js
│   │   │   ├── Settings.js
│   │   │   ├── QuerySearch.js
│   │   │   └── NotificationProvider.js
│   │   └── App.js
│   └── package.json
├── server/
│   └── index.js                # Express backend
├── src/
│   ├── data/                   # JSON data files
│   └── scripts/                # Original utility scripts
├── uploads/                    # Temporary upload directory
├── .env                        # Environment variables
├── package.json
└── README.md
```

## Error Handling

The application includes comprehensive error handling:

- **File Upload Errors**: Invalid formats, size limits
- **API Errors**: Network issues, authentication failures
- **Database Errors**: Connection issues, query failures
- **Validation Errors**: Missing required fields, invalid inputs

## Security Features

- Environment variable masking for sensitive data
- Input validation and sanitization
- Secure file upload handling
- CORS protection
- Error message sanitization

## Development

### Adding New Features

1. **Backend**: Add routes in `server/index.js`
2. **Frontend**: Create components in `client/src/components/`
3. **Styling**: Use Material-UI components and theme

### Testing

```bash
# Test backend API
curl http://localhost:5000/api/health

# Test file upload
curl -X POST -F "file=@testfile.xlsx" http://localhost:5000/api/upload-excel
```

## Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   - Verify connection string in `.env`
   - Check network access in MongoDB Atlas
   - Ensure correct database/collection names

2. **TestLeaf API Errors**
   - Verify API credentials
   - Check API endpoint URL
   - Monitor rate limits

3. **File Upload Issues**
   - Check file format (.xlsx, .xls)
   - Verify upload directory permissions
   - Ensure sufficient disk space

4. **Search Not Working**
   - Verify Vector Search index is created
   - Check embedding dimensions (1536)
   - Ensure documents have embeddings

### Logs

- Backend logs: Console output from server
- Frontend logs: Browser developer console
- API logs: Network tab in browser

## License

This project is for demonstration purposes.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review API logs and error messages
3. Verify environment configuration
4. Contact support team

---

**Version**: 1.0.0  
**Last Updated**: October 2025