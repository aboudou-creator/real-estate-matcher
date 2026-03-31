const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  post1: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  post2: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  score: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },
  matchType: {
    type: String,
    enum: ['offer_demand', 'demand_offer'],
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  viewed: {
    type: Boolean,
    default: false
  }
});

matchSchema.index({ score: -1 });
matchSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Match', matchSchema);
