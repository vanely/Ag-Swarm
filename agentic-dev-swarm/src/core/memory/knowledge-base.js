/**
 * Knowledge Base for the Agentic Software Development Swarm
 * 
 * This module provides a knowledge base for storing and retrieving
 * best practices, patterns, solutions, and other development knowledge.
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');
const VectorDB = require('./vector-db');

class KnowledgeBase extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      enabled: config.enabled !== false,
      persistToFileSystem: config.persistToFileSystem !== false,
      updateFrequency: config.updateFrequency || 3600000, // 1 hour
      storagePath: config.storagePath || './data/knowledge',
      categories: config.categories || [
        'best-practices',
        'patterns',
        'solutions',
        'libraries',
        'apis',
        'errors',
        'performance',
        'security'
      ],
      maxEntryHistorySize: config.maxEntryHistorySize || 10,
      vectorDbEnabled: config.vectorDbEnabled !== false,
      ...config
    };
    
    // Initialize storage
    this.knowledge = new Map();
    this.entryHistory = new Map();
    
    // Initialize vector database if enabled
    this.vectorDb = null;
    
    if (this.config.vectorDbEnabled) {
      this.vectorDb = new VectorDB(config.vectorDb || {});
    }
    
    // Set up automatic persistence if enabled
    if (this.config.enabled && this.config.persistToFileSystem) {
      this.setupPersistence();
    }
    
    logger.info('Knowledge Base initialized');
    logger.debug(`Knowledge Base configuration: ${JSON.stringify({
      ...this.config,
      vectorDb: this.config.vectorDbEnabled ? 'enabled' : 'disabled'
    })}`);
  }
  
  /**
   * Set up automatic persistence
   */
  setupPersistence() {
    // Schedule periodic persistence
    this.persistenceTimer = setInterval(() => {
      this.persistToFileSystem().catch(error => {
        logger.error(`Error persisting knowledge base: ${error.message}`);
      });
    }, this.config.updateFrequency);
    
    // Ensure storage directory exists
    this.ensureStorageDirectory().catch(error => {
      logger.error(`Error creating knowledge base storage directory: ${error.message}`);
    });
    
    // Load persisted knowledge
    this.loadFromFileSystem().catch(error => {
      logger.error(`Error loading knowledge base from file system: ${error.message}`);
    });
    
    logger.info('Knowledge Base persistence enabled');
  }
  
  /**
   * Ensure storage directory exists
   */
  async ensureStorageDirectory() {
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });
      
      // Create category directories
      for (const category of this.config.categories) {
        await fs.mkdir(path.join(this.config.storagePath, category), { recursive: true });
      }
      
      logger.debug('Knowledge Base storage directories created');
    } catch (error) {
      logger.error(`Error creating knowledge base storage directories: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Initialize the knowledge base
   */
  async initialize() {
    try {
      // Connect to vector database if enabled
      if (this.config.vectorDbEnabled && this.vectorDb) {
        await this.vectorDb.connect();
      }
      
      // Load persisted knowledge if enabled
      if (this.config.persistToFileSystem) {
        await this.loadFromFileSystem();
      }
      
      logger.info('Knowledge Base initialized');
      this.emit('initialized');
      
      return true;
    } catch (error) {
      logger.error(`Failed to initialize Knowledge Base: ${error.message}`);
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Store a knowledge entry
   * 
   * @param {string} category - Knowledge category
   * @param {string} key - Entry key
   * @param {Object} entry - Knowledge entry
   * @returns {Object} Stored entry
   */
  async storeEntry(category, key, entry) {
    // Validate category
    if (!this.config.categories.includes(category)) {
      throw new Error(`Invalid category: ${category}. Valid categories are: ${this.config.categories.join(', ')}`);
    }
    
    // Validate key and entry
    if (!key || typeof key !== 'string') {
      throw new Error('Entry key must be a non-empty string');
    }
    
    if (!entry || typeof entry !== 'object') {
      throw new Error('Entry must be a non-empty object');
    }
    
    try {
      // Check if entry already exists
      const existingEntry = this.getEntry(category, key);
      
      // Prepare entry with metadata
      const now = Date.now();
      const enhancedEntry = {
        ...entry,
        _metadata: {
          key,
          category,
          createdAt: existingEntry?._metadata?.createdAt || now,
          updatedAt: now,
          version: (existingEntry?._metadata?.version || 0) + 1,
          tags: entry.tags || existingEntry?._metadata?.tags || [],
        }
      };
      
      // Store in category map
      if (!this.knowledge.has(category)) {
        this.knowledge.set(category, new Map());
      }
      
      const categoryMap = this.knowledge.get(category);
      categoryMap.set(key, enhancedEntry);
      
      // Add to entry history
      this.updateEntryHistory(category, key, enhancedEntry);
      
      // Index in vector database if enabled
      if (this.config.vectorDbEnabled && this.vectorDb) {
        await this.indexEntryInVectorDb(category, key, enhancedEntry);
      }
      
      // Persist to file system if enabled
      if (this.config.persistToFileSystem) {
        await this.persistEntryToFile(category, key, enhancedEntry);
      }
      
      logger.info(`Stored knowledge entry in category '${category}' with key '${key}'`);
      this.emit('entry:stored', { category, key, entry: enhancedEntry });
      
      return enhancedEntry;
    } catch (error) {
      logger.error(`Error storing knowledge entry: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get a knowledge entry
   * 
   * @param {string} category - Knowledge category
   * @param {string} key - Entry key
   * @returns {Object|null} Knowledge entry or null if not found
   */
  getEntry(category, key) {
    // Check if category exists
    if (!this.knowledge.has(category)) {
      return null;
    }
    
    // Check if entry exists
    const categoryMap = this.knowledge.get(category);
    
    if (!categoryMap.has(key)) {
      return null;
    }
    
    return categoryMap.get(key);
  }
  
  /**
   * Delete a knowledge entry
   * 
   * @param {string} category - Knowledge category
   * @param {string} key - Entry key
   * @returns {boolean} Success flag
   */
  async deleteEntry(category, key) {
    // Check if category exists
    if (!this.knowledge.has(category)) {
      return false;
    }
    
    // Check if entry exists
    const categoryMap = this.knowledge.get(category);
    
    if (!categoryMap.has(key)) {
      return false;
    }
    
    try {
      // Delete from category map
      categoryMap.delete(key);
      
      // Delete from entry history
      this.entryHistory.delete(`${category}:${key}`);
      
      // Delete from vector database if enabled
      if (this.config.vectorDbEnabled && this.vectorDb) {
        await this.deleteEntryFromVectorDb(category, key);
      }
      
      // Delete from file system if enabled
      if (this.config.persistToFileSystem) {
        await this.deleteEntryFile(category, key);
      }
      
      logger.info(`Deleted knowledge entry from category '${category}' with key '${key}'`);
      this.emit('entry:deleted', { category, key });
      
      return true;
    } catch (error) {
      logger.error(`Error deleting knowledge entry: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * List all entries in a category
   * 
   * @param {string} category - Knowledge category
   * @returns {Array<Object>} Array of entries
   */
  listEntriesInCategory(category) {
    // Check if category exists
    if (!this.knowledge.has(category)) {
      return [];
    }
    
    // Get all entries in category
    const categoryMap = this.knowledge.get(category);
    return Array.from(categoryMap.values());
  }
  
  /**
   * List all categories
   * 
   * @returns {Array<string>} Array of categories
   */
  listCategories() {
    return this.config.categories;
  }
  
  /**
   * Search for entries by text
   * 
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Array<Object>} Search results
   */
  async search(query, options = {}) {
    const searchOptions = {
      categories: options.categories || this.config.categories,
      limit: options.limit || 10,
      ...options
    };
    
    try {
      // Search in vector database if enabled
      if (this.config.vectorDbEnabled && this.vectorDb) {
        return await this.vectorDbSearch(query, searchOptions);
      }
      
      // Otherwise do a simple text search
      return await this.simpleTextSearch(query, searchOptions);
    } catch (error) {
      logger.error(`Error searching knowledge base: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Search using vector database
   * 
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Array<Object>} Search results
   */
  async vectorDbSearch(query, options) {
    try {
      // Prepare filter for selected categories
      const filter = {
        entryType: { $eq: 'knowledge-base' },
        category: { $in: options.categories }
      };
      
      // Search in vector database
      const results = await this.vectorDb.searchByText(query, {
        filter,
        topK: options.limit
      });
      
      // Convert results to entries
      return results.map(result => {
        const { category, key } = result.metadata;
        
        // Get the full entry
        const entry = this.getEntry(category, key);
        
        return {
          category,
          key,
          entry,
          score: result.score
        };
      });
    } catch (error) {
      logger.error(`Error searching vector database: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Simple text search without vector database
   * 
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Array<Object>} Search results
   */
  async simpleTextSearch(query, options) {
    const results = [];
    const lowerQuery = query.toLowerCase();
    
    // Search in each selected category
    for (const category of options.categories) {
      if (!this.knowledge.has(category)) {
        continue;
      }
      
      const categoryMap = this.knowledge.get(category);
      
      // Check each entry in the category
      for (const [key, entry] of categoryMap.entries()) {
        // Simple scoring based on text match
        const score = this.calculateSimpleScore(entry, lowerQuery);
        
        if (score > 0) {
          results.push({
            category,
            key,
            entry,
            score
          });
        }
      }
    }
    
    // Sort by score (descending) and limit results
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, options.limit);
  }
  
  /**
   * Calculate a simple search score for an entry
   * 
   * @param {Object} entry - Knowledge entry
   * @param {string} query - Lowercase search query
   * @returns {number} Score
   */
  calculateSimpleScore(entry, query) {
    let score = 0;
    
    // Check key
    if (entry._metadata.key.toLowerCase().includes(query)) {
      score += 10;
    }
    
    // Check title
    if (entry.title && entry.title.toLowerCase().includes(query)) {
      score += 8;
    }
    
    // Check tags
    if (entry._metadata.tags && entry._metadata.tags.some(tag => tag.toLowerCase().includes(query))) {
      score += 5;
    }
    
    // Check description
    if (entry.description && entry.description.toLowerCase().includes(query)) {
      score += 3;
    }
    
    // Check content
    if (entry.content && entry.content.toLowerCase().includes(query)) {
      score += 2;
    }
    
    // Check other fields
    for (const [key, value] of Object.entries(entry)) {
      if (key === '_metadata' || 
          key === 'title' || 
          key === 'description' || 
          key === 'content') {
        continue;
      }
      
      if (typeof value === 'string' && value.toLowerCase().includes(query)) {
        score += 1;
      }
    }
    
    return score;
  }
  
  /**
   * Find similar entries
   * 
   * @param {string} category - Knowledge category
   * @param {string} key - Entry key
   * @param {Object} options - Search options
   * @returns {Array<Object>} Similar entries
   */
  async findSimilar(category, key, options = {}) {
    const entry = this.getEntry(category, key);
    
    if (!entry) {
      throw new Error(`Entry not found: ${category}/${key}`);
    }
    
    const searchOptions = {
      limit: options.limit || 10,
      excludeSelf: options.excludeSelf !== false,
      ...options
    };
    
    try {
      // Search in vector database if enabled
      if (this.config.vectorDbEnabled && this.vectorDb) {
        return await this.vectorDbSimilarSearch(entry, searchOptions);
      }
      
      // Otherwise do a simple similarity search
      return await this.simpleTextSearch(entry.title || entry._metadata.key, searchOptions);
    } catch (error) {
      logger.error(`Error finding similar entries: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Find similar entries using vector database
   * 
   * @param {Object} entry - Knowledge entry
   * @param {Object} options - Search options
   * @returns {Array<Object>} Similar entries
   */
  async vectorDbSimilarSearch(entry, options) {
    try {
      // Prepare filter
      const filter = {
        entryType: { $eq: 'knowledge-base' }
      };
      
      // Exclude self if requested
      if (options.excludeSelf) {
        filter.key = { $ne: entry._metadata.key };
        filter.category = { $eq: entry._metadata.category };
      }
      
      // Create query text
      const queryText = [
        entry.title || '',
        entry.description || '',
        entry._metadata.tags?.join(' ') || ''
      ].join(' ');
      
      // Search in vector database
      const results = await this.vectorDb.searchByText(queryText, {
        filter,
        topK: options.limit
      });
      
      // Convert results to entries
      return results.map(result => {
        const { category, key } = result.metadata;
        
        // Get the full entry
        const entry = this.getEntry(category, key);
        
        return {
          category,
          key,
          entry,
          score: result.score
        };
      });
    } catch (error) {
      logger.error(`Error searching vector database for similar entries: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get the history of an entry
   * 
   * @param {string} category - Knowledge category
   * @param {string} key - Entry key
   * @returns {Array<Object>} Entry history
   */
  getEntryHistory(category, key) {
    const historyKey = `${category}:${key}`;
    
    if (!this.entryHistory.has(historyKey)) {
      return [];
    }
    
    return this.entryHistory.get(historyKey);
  }
  
  /**
   * Update the history of an entry
   * 
   * @param {string} category - Knowledge category
   * @param {string} key - Entry key
   * @param {Object} entry - Knowledge entry
   */
  updateEntryHistory(category, key, entry) {
    const historyKey = `${category}:${key}`;
    
    if (!this.entryHistory.has(historyKey)) {
      this.entryHistory.set(historyKey, []);
    }
    
    const history = this.entryHistory.get(historyKey);
    
    // Add to history
    history.unshift({
      timestamp: Date.now(),
      version: entry._metadata.version,
      entry: { ...entry }
    });
    
    // Trim history if needed
    if (history.length > this.config.maxEntryHistorySize) {
      history.length = this.config.maxEntryHistorySize;
    }
  }
  
  /**
   * Find entries by tags
   * 
   * @param {Array<string>} tags - Array of tags
   * @param {Object} options - Search options
   * @returns {Array<Object>} Found entries
   */
  findEntriesByTags(tags, options = {}) {
    if (!tags || !Array.isArray(tags) || tags.length === 0) {
      throw new Error('Tags must be a non-empty array');
    }
    
    const searchOptions = {
      categories: options.categories || this.config.categories,
      matchAll: options.matchAll !== false,
      limit: options.limit || 100,
      ...options
    };
    
    const results = [];
    const lowerTags = tags.map(tag => tag.toLowerCase());
    
    // Search in each selected category
    for (const category of searchOptions.categories) {
      if (!this.knowledge.has(category)) {
        continue;
      }
      
      const categoryMap = this.knowledge.get(category);
      
      // Check each entry in the category
      for (const [key, entry] of categoryMap.entries()) {
        // Skip if entry has no tags
        if (!entry._metadata.tags || entry._metadata.tags.length === 0) {
          continue;
        }
        
        const entryLowerTags = entry._metadata.tags.map(tag => tag.toLowerCase());
        
        // Check if entry matches tags
        let match;
        
        if (searchOptions.matchAll) {
          // Entry must have all specified tags
          match = lowerTags.every(tag => entryLowerTags.includes(tag));
        } else {
          // Entry must have at least one of the specified tags
          match = lowerTags.some(tag => entryLowerTags.includes(tag));
        }
        
        if (match) {
          results.push({
            category,
            key,
            entry
          });
        }
      }
    }
    
    // Sort by updated date (descending) and limit results
    results.sort((a, b) => 
      b.entry._metadata.updatedAt - a.entry._metadata.updatedAt
    );
    
    return results.slice(0, searchOptions.limit);
  }
  
  /**
   * Index entry in vector database
   * 
   * @param {string} category - Knowledge category
   * @param {string} key - Entry key
   * @param {Object} entry - Knowledge entry
   */
  async indexEntryInVectorDb(category, key, entry) {
    if (!this.config.vectorDbEnabled || !this.vectorDb) {
      return;
    }
    
    try {
      // Create a text representation of the entry
      const entryText = [
        entry.title || '',
        entry.description || '',
        entry._metadata.tags?.join(' ') || '',
        entry.content || '',
        JSON.stringify(entry).substring(0, 10000) // Include serialized entry up to 10k chars
      ].join('\n\n');
      
      // Index in vector database
      await this.vectorDb.indexDocument(entryText, {
        entryType: 'knowledge-base',
        category,
        key,
        title: entry.title || key,
        tags: entry._metadata.tags || [],
        updatedAt: entry._metadata.updatedAt
      });
      
      logger.debug(`Indexed knowledge entry in vector database: ${category}/${key}`);
    } catch (error) {
      logger.error(`Error indexing knowledge entry in vector database: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Delete entry from vector database
   * 
   * @param {string} category - Knowledge category
   * @param {string} key - Entry key
   */
  async deleteEntryFromVectorDb(category, key) {
    if (!this.config.vectorDbEnabled || !this.vectorDb) {
      return;
    }
    
    try {
      // Delete from vector database by ID pattern
      const entriesWithSameId = await this.vectorDb.searchByMetadata({
        entryType: { $eq: 'knowledge-base' },
        category: { $eq: category },
        key: { $eq: key }
      });
      
      // Delete all matching entries
      for (const result of entriesWithSameId) {
        await this.vectorDb.deleteVectors([result.id]);
      }
      
      logger.debug(`Deleted knowledge entry from vector database: ${category}/${key}`);
    } catch (error) {
      logger.error(`Error deleting knowledge entry from vector database: ${error.message}`);
      // Don't throw here, as this is secondary to the main operation
    }
  }
  
  /**
   * Persist entry to file
   * 
   * @param {string} category - Knowledge category
   * @param {string} key - Entry key
   * @param {Object} entry - Knowledge entry
   */
  async persistEntryToFile(category, key, entry) {
    if (!this.config.persistToFileSystem) {
      return;
    }
    
    try {
      // Create a safe filename from the key
      const safeKey = key.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filePath = path.join(this.config.storagePath, category, `${safeKey}.json`);
      
      // Write to file
      await fs.writeFile(
        filePath,
        JSON.stringify(entry, null, 2),
        'utf8'
      );
      
      logger.debug(`Persisted knowledge entry to file: ${filePath}`);
    } catch (error) {
      logger.error(`Error persisting knowledge entry to file: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Delete entry file
   * 
   * @param {string} category - Knowledge category
   * @param {string} key - Entry key
   */
  async deleteEntryFile(category, key) {
    if (!this.config.persistToFileSystem) {
      return;
    }
    
    try {
      // Create a safe filename from the key
      const safeKey = key.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filePath = path.join(this.config.storagePath, category, `${safeKey}.json`);
      
      // Delete file
      await fs.unlink(filePath);
      
      logger.debug(`Deleted knowledge entry file: ${filePath}`);
    } catch (error) {
      // Ignore file not found errors
      if (error.code !== 'ENOENT') {
        logger.error(`Error deleting knowledge entry file: ${error.message}`);
        throw error;
      }
    }
  }
  
  /**
   * Persist all entries to file system
   */
  async persistToFileSystem() {
    if (!this.config.persistToFileSystem) {
      return;
    }
    
    try {
      // Create storage directory if it doesn't exist
      await this.ensureStorageDirectory();
      
      // Persist each category
      for (const category of this.config.categories) {
        if (!this.knowledge.has(category)) {
          continue;
        }
        
        const categoryMap = this.knowledge.get(category);
        
        // Persist each entry in the category
        for (const [key, entry] of categoryMap.entries()) {
          await this.persistEntryToFile(category, key, entry);
        }
      }
      
      logger.info('Persisted all knowledge entries to file system');
    } catch (error) {
      logger.error(`Error persisting knowledge base to file system: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Load entries from file system
   */
  async loadFromFileSystem() {
    if (!this.config.persistToFileSystem) {
      return;
    }
    
    try {
      // Load each category
      for (const category of this.config.categories) {
        const categoryDir = path.join(this.config.storagePath, category);
        
        // Create category map if it doesn't exist
        if (!this.knowledge.has(category)) {
          this.knowledge.set(category, new Map());
        }
        
        const categoryMap = this.knowledge.get(category);
        
        try {
          // Read directory
          const files = await fs.readdir(categoryDir);
          
          // Load each file
          for (const file of files) {
            if (!file.endsWith('.json')) {
              continue;
            }
            
            try {
              // Read file
              const filePath = path.join(categoryDir, file);
              const content = await fs.readFile(filePath, 'utf8');
              const entry = JSON.parse(content);
              
              // Extract key from entry
              const key = entry._metadata?.key;
              
              if (!key) {
                logger.warn(`Skipping entry without key: ${filePath}`);
                continue;
              }
              
              // Add to category map
              categoryMap.set(key, entry);
              
              // Add to entry history
              this.updateEntryHistory(category, key, entry);
            } catch (error) {
              logger.error(`Error loading entry file ${file}: ${error.message}`);
              // Continue with other files
            }
          }
        } catch (error) {
          if (error.code === 'ENOENT') {
            // Directory doesn't exist yet, create it
            await fs.mkdir(categoryDir, { recursive: true });
          } else {
            logger.error(`Error reading category directory ${category}: ${error.message}`);
          }
          // Continue with other categories
        }
      }
      
      logger.info('Loaded knowledge entries from file system');
    } catch (error) {
      logger.error(`Error loading knowledge base from file system: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get statistics about the knowledge base
   * 
   * @returns {Object} Statistics
   */
  getStatistics() {
    const stats = {
      totalEntries: 0,
      categories: {}
    };
    
    // Count entries in each category
    for (const category of this.config.categories) {
      if (!this.knowledge.has(category)) {
        stats.categories[category] = 0;
        continue;
      }
      
      const categoryMap = this.knowledge.get(category);
      const count = categoryMap.size;
      
      stats.categories[category] = count;
      stats.totalEntries += count;
    }
    
    return stats;
  }
  
  /**
   * Clean up resources
   */
  async shutdown() {
    try {
      // Clear persistence timer
      if (this.persistenceTimer) {
        clearInterval(this.persistenceTimer);
      }
      
      // Persist all entries if enabled
      if (this.config.persistToFileSystem) {
        await this.persistToFileSystem();
      }
      
      // Disconnect from vector database if enabled
      if (this.config.vectorDbEnabled && this.vectorDb) {
        await this.vectorDb.disconnect();
      }
      
      logger.info('Knowledge Base shut down');
    } catch (error) {
      logger.error(`Error shutting down Knowledge Base: ${error.message}`);
      throw error;
    }
  }
}

module.exports = KnowledgeBase;
