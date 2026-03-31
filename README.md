# Real Estate Matcher

A web application that automatically matches real estate posts from WhatsApp groups, featuring duplicate detection and smart aggregation.

## Features

- **WhatsApp Integration**: Uses Baileys to scrape real estate posts from WhatsApp groups
- **Smart Classification**: Automatically categorizes posts as offers or demands
- **Property Types**: Supports apartments, houses, grounds, and agricultural land
- **Transaction Types**: Handles both sales and rentals
- **Intelligent Matching**: Matches offers with corresponding demands based on multiple criteria
- **Duplicate Detection**: Identifies and aggregates similar posts from different users
- **Real-time Updates**: Live updates via WebSocket connections
- **Modern UI**: Clean, responsive interface built with React and Tailwind CSS

## Architecture

### Backend (Node.js)
- **Express.js** server with Socket.IO for real-time communication
- **MongoDB** for data storage with Mongoose ODM
- **Baileys** for WhatsApp Web API integration
- **Natural Language Processing** for text similarity and classification

### Frontend (React)
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **Socket.IO Client** for real-time updates
- **Lucide React** for icons

## Installation

### Prerequisites
- Node.js (v16 or higher)
- MongoDB
- npm or yarn

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd real-estate-matcher
   ```

2. **Install dependencies**
   ```bash
   # Install root dependencies
   npm install
   
   # Install server dependencies
   cd server
   npm install
   
   # Install client dependencies
   cd ../client
   npm install
   ```

3. **Environment Configuration**
   
   Create a `.env` file in the `server` directory:
   ```env
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/real-estate-matcher
   ```

4. **Start MongoDB**
   ```bash
   # Make sure MongoDB is running on your system
   mongod
   ```

5. **Run the application**
   ```bash
   # From the root directory
   npm run dev
   ```
   
   This will start both the backend server (port 5000) and frontend development server (port 3000).

## Usage

1. **Connect to WhatsApp**
   - Open the web application at `http://localhost:3000`
   - Scan the QR code with WhatsApp to connect
   - The app will automatically start monitoring group messages

2. **View Posts**
   - Browse real-time posts from WhatsApp groups
   - Filter by offers, demands, or view all posts
   - See extracted information like price, location, bedrooms, etc.

3. **View Matches**
   - See automatically matched offers and demands
   - Match scores indicate compatibility percentage
   - Click to view detailed information about both posts

4. **View Aggregated Posts**
   - See duplicate posts grouped together
   - View price ranges and similarity scores
   - Expand to see all variants of the same property

## API Endpoints

### Posts
- `GET /api/posts` - Get all posts
- `GET /api/posts/aggregated` - Get aggregated posts with duplicates

### Matches
- `GET /api/matches` - Get all matches

### Status
- `GET /api/status` - Get WhatsApp connection status

## Data Models

### Post
```typescript
interface Post {
  _id: string;
  whatsappMessageId: string;
  groupId: string;
  sender: string;
  text: string;
  type: 'offer' | 'demand';
  category: 'apartment' | 'house' | 'ground' | 'agricultural_ground';
  transactionType: 'sale' | 'rent';
  location?: string;
  price?: number;
  bedrooms?: number;
  area?: number;
  description?: string;
  timestamp: string;
  isDuplicate?: boolean;
  duplicates?: Array<{ postId: string; similarityScore: number }>;
}
```

### Match
```typescript
interface Match {
  _id: string;
  post1: Post;
  post2: Post;
  score: number; // 0-1
  matchType: 'offer_demand' | 'demand_offer';
  createdAt: string;
  viewed: boolean;
}
```

## Matching Algorithm

The system uses a multi-factor matching algorithm:

1. **Price Similarity** (35% weight): Compares prices within 20% tolerance
2. **Location Similarity** (30% weight): Text similarity of location descriptions
3. **Description Similarity** (25% weight): Overall text content similarity
4. **Bedrooms Match** (5% weight): Exact or ±1 bedroom tolerance
5. **Area Similarity** (5% weight): Compares property sizes within 15% tolerance

## Duplicate Detection

Posts are flagged as duplicates when:
- Same category, transaction type, and post type
- Posted within 24 hours of each other
- Overall similarity score > 80%
- Based on price, location, text content, and property features

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For issues and questions, please open an issue on the GitHub repository.
