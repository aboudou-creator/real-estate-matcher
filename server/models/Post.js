const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  whatsappMessageId: {
    type: String,
    required: true,
    unique: true
  },
  groupId: {
    type: String,
    required: true
  },
  sender: {
    type: String,
    required: true
  },
  text: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['offer', 'demand'],
    required: true
  },
  category: {
    type: String,
    enum: ['apartment', 'house', 'ground', 'agricultural_ground'],
    required: true
  },
  transactionType: {
    type: String,
    enum: ['sale', 'rent'],
    required: true
  },
  location: String,
  price: Number,
  bedrooms: Number,
  area: Number,
  description: String,
  timestamp: {
    type: Date,
    default: Date.now
  },
  duplicates: [{
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post'
    },
    similarityScore: Number
  }],
  isDuplicate: {
    type: Boolean,
    default: false
  },
  originalPost: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  }
});

postSchema.index({ groupId: 1, timestamp: -1 });
postSchema.index({ type: 1, category: 1, transactionType: 1 });
postSchema.index({ location: 'text', description: 'text' });

module.exports = mongoose.model('Post', postSchema);
