const Post = require('../models/Post');
const { JaroWinklerDistance } = require('natural');
const stringSimilarity = require('string-similarity');

class DuplicateDetector {
  static async findDuplicates(newPost) {
    try {
      // Find potential duplicates based on similar characteristics
      const potentialDuplicates = await Post.find({
        _id: { $ne: newPost._id },
        category: newPost.category,
        transactionType: newPost.transactionType,
        type: newPost.type,
        timestamp: { 
          $gte: new Date(newPost.timestamp.getTime() - 24 * 60 * 60 * 1000), // Last 24 hours
          $lte: new Date(newPost.timestamp.getTime() + 24 * 60 * 60 * 1000)
        }
      });

      const duplicates = [];

      for (const candidate of potentialDuplicates) {
        const similarityScore = this.calculateSimilarity(newPost, candidate);
        
        if (similarityScore > 0.8) { // High threshold for duplicates
          duplicates.push({
            postId: candidate._id,
            similarityScore
          });
        }
      }

      // Update the new post with duplicates
      if (duplicates.length > 0) {
        await Post.findByIdAndUpdate(newPost._id, {
          duplicates,
          isDuplicate: true,
          originalPost: duplicates[0].postId // Mark first duplicate as original
        });

        // Update original posts with reference to this duplicate
        for (const dup of duplicates) {
          await Post.findByIdAndUpdate(dup.postId, {
            $push: {
              duplicates: {
                postId: newPost._id,
                similarityScore: dup.similarityScore
              }
            }
          });
        }
      }

      return duplicates;
    } catch (error) {
      console.error('Error finding duplicates:', error);
      return [];
    }
  }

  static calculateSimilarity(post1, post2) {
    let totalScore = 0;
    let factors = 0;

    // Price similarity (very important)
    if (post1.price && post2.price) {
      const priceDiff = Math.abs(post1.price - post2.price) / Math.max(post1.price, post2.price);
      const priceScore = 1 - priceDiff;
      totalScore += priceScore * 0.35;
      factors += 0.35;
    }

    // Location similarity (very important)
    if (post1.location && post2.location) {
      const locationScore = JaroWinklerDistance(post1.location.toLowerCase(), post2.location.toLowerCase());
      totalScore += locationScore * 0.3;
      factors += 0.3;
    }

    // Text similarity (important)
    const textScore = JaroWinklerDistance(
      post1.text.toLowerCase().substring(0, 200),
      post2.text.toLowerCase().substring(0, 200)
    );
    totalScore += textScore * 0.25;
    factors += 0.25;

    // Bedrooms similarity
    if (post1.bedrooms && post2.bedrooms) {
      const bedroomScore = post1.bedrooms === post2.bedrooms ? 1 : 0.5;
      totalScore += bedroomScore * 0.05;
      factors += 0.05;
    }

    // Area similarity
    if (post1.area && post2.area) {
      const areaDiff = Math.abs(post1.area - post2.area) / Math.max(post1.area, post2.area);
      const areaScore = 1 - areaDiff;
      totalScore += areaScore * 0.05;
      factors += 0.05;
    }

    return factors > 0 ? totalScore / factors : 0;
  }

  static async getAggregatedPosts() {
    try {
      // Find all original posts (non-duplicates)
      const originalPosts = await Post.find({
        isDuplicate: { $ne: true }
      }).populate('duplicates.postId');

      const aggregatedPosts = originalPosts.map(post => {
        const allVariants = [post, ...post.duplicates.map(d => d.postId)];
        
        return {
          originalPost: post,
          variants: allVariants,
          duplicateCount: post.duplicates.length,
          uniquePosters: [...new Set(allVariants.map(p => p.sender))].length,
          priceRange: {
            min: Math.min(...allVariants.filter(p => p.price).map(p => p.price)),
            max: Math.max(...allVariants.filter(p => p.price).map(p => p.price))
          },
          averageSimilarity: post.duplicates.length > 0 
            ? post.duplicates.reduce((sum, d) => sum + d.similarityScore, 0) / post.duplicates.length 
            : 1
        };
      });

      return aggregatedPosts;
    } catch (error) {
      console.error('Error getting aggregated posts:', error);
      return [];
    }
  }
}

module.exports = DuplicateDetector;
