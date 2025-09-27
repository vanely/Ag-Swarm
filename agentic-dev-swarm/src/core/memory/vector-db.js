/**
 * Vector Database for the Agentic Software Development Swarm
 * 
 * This module provides a vector database interface for storing and retrieving
 * embeddings for code, documentation, and other knowledge.
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');
const { PineconeClient } = require('@pinecone-database/pinecone');
const axios = require('axios');
const crypto = require('crypto');

class VectorDB extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      provider: config.provider || 'pinecone',
      apiKey: config.apiKey || process.env.PINECONE_API_KEY,
      environment: config.environment || process.env.PINECONE_ENVIRONMENT || 'production',
      projectId: config.projectId || process.env.PINECONE_PROJECT_ID,
      namespace: config.namespace || 'agentic-swarm',
      dimensions: config.dimensions || 1536, // OpenAI Ada-2 dimensions
      embedModelProvider: config.embedModelProvider || 'openai',
      embedModelName: config.embedModelName || 'text-embedding-ada-002',
      openaiApiKey: config.openaiApiKey || process.env.OPENAI_API_KEY,
      chunkSize: config.chunkSize || 1000,
      chunkOverlap: config.chunkOverlap || 200,
      indexName: config.indexName || 'agentic-swarm',
      batchSize: config.batchSize || 100,
      // Optional parameters for other vector DB providers
      weaviateUrl: config.weaviateUrl || null,
      weaviateApiKey: config.weaviateApiKey || null,
      qdrantUrl: config.qdrantUrl || null,
      qdrantApiKey: config.qdrantApiKey || null,
      ...config
    };
    
    this.client = null;
    this.index = null;
    this.isConnected = false;
    
    // Cache for embeddings to avoid re-embedding the same content
    this.embeddingCache = new Map();
    
    logger.info('Vector Database initialized');
    logger.debug(`Vector DB configuration provider: ${this.config.provider}`);
  }
  
  /**
   * Connect to the vector database
   */
  async connect() {
    if (this.isConnected) {
      logger.debug('Already connected to vector database');
      return;
    }
    
    try {
      // Connect based on the configured provider
      switch (this.config.provider) {
        case 'pinecone':
          await this.connectPinecone();
          break;
          
        case 'weaviate':
          await this.connectWeaviate();
          break;
          
        case 'qdrant':
          await this.connectQdrant();
          break;
          
        default:
          throw new Error(`Unsupported vector database provider: ${this.config.provider}`);
      }
      
      this.isConnected = true;
      logger.info(`Connected to ${this.config.provider} vector database`);
      this.emit('connected');
      
      return true;
    } catch (error) {
      logger.error(`Failed to connect to vector database: ${error.message}`);
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Connect to Pinecone vector database
   */
  async connectPinecone() {
    if (!this.config.apiKey) {
      throw new Error('Pinecone API key is required');
    }
    
    // Initialize Pinecone client
    this.client = new PineconeClient();
    
    await this.client.init({
      apiKey: this.config.apiKey,
      environment: this.config.environment
    });
    
    // List indexes to check if our index exists
    const indexes = await this.client.listIndexes();
    
    if (!indexes.includes(this.config.indexName)) {
      logger.info(`Index ${this.config.indexName} not found, creating it...`);
      
      // Create the index
      await this.client.createIndex({
        createRequest: {
          name: this.config.indexName,
          dimension: this.config.dimensions,
          metric: 'cosine'
        }
      });
      
      // Wait for the index to be ready
      let indexReady = false;
      let attempts = 0;
      
      while (!indexReady && attempts < 10) {
        const describeResult = await this.client.describeIndex({
          indexName: this.config.indexName
        });
        
        indexReady = describeResult.status?.ready === true;
        
        if (!indexReady) {
          logger.debug(`Waiting for index to be ready (attempt ${attempts + 1}/10)...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          attempts++;
        }
      }
      
      if (!indexReady) {
        throw new Error(`Index ${this.config.indexName} was created but did not become ready`);
      }
      
      logger.info(`Index ${this.config.indexName} created successfully`);
    }
    
    // Connect to the index
    this.index = this.client.Index(this.config.indexName);
    
    logger.debug(`Connected to Pinecone index ${this.config.indexName}`);
  }
  
  /**
   * Connect to Weaviate vector database
   */
  async connectWeaviate() {
    if (!this.config.weaviateUrl) {
      throw new Error('Weaviate URL is required');
    }
    
    // This is a placeholder for Weaviate connection
    // In a real implementation, you would use the Weaviate JS client
    
    logger.info('Weaviate connection not implemented yet');
    throw new Error('Weaviate connection not implemented yet');
  }
  
  /**
   * Connect to Qdrant vector database
   */
  async connectQdrant() {
    if (!this.config.qdrantUrl) {
      throw new Error('Qdrant URL is required');
    }
    
    // This is a placeholder for Qdrant connection
    // In a real implementation, you would use the Qdrant JS client
    
    logger.info('Qdrant connection not implemented yet');
    throw new Error('Qdrant connection not implemented yet');
  }
  
  /**
   * Create embeddings for text content
   * 
   * @param {string|Array<string>} texts - Text content to embed
   * @returns {Array<Array<number>>} Array of embeddings
   */
  async createEmbeddings(texts) {
    // Ensure texts is an array
    const textArray = Array.isArray(texts) ? texts : [texts];
    
    if (textArray.length === 0) {
      return [];
    }
    
    // Check if we have these embeddings in cache
    const cachedEmbeddings = [];
    const textsToEmbed = [];
    const textIndices = [];
    
    for (let i = 0; i < textArray.length; i++) {
      const text = textArray[i];
      const hash = this.hashText(text);
      
      if (this.embeddingCache.has(hash)) {
        cachedEmbeddings[i] = this.embeddingCache.get(hash);
      } else {
        textsToEmbed.push(text);
        textIndices.push(i);
      }
    }
    
    // If all embeddings are cached, return them
    if (textsToEmbed.length === 0) {
      logger.debug(`All ${textArray.length} embeddings found in cache`);
      return cachedEmbeddings;
    }
    
    logger.debug(`Creating embeddings for ${textsToEmbed.length} texts`);
    
    // Create embeddings based on the configured provider
    let newEmbeddings = [];
    
    switch (this.config.embedModelProvider) {
      case 'openai':
        newEmbeddings = await this.createOpenAIEmbeddings(textsToEmbed);
        break;
        
      // Add other embedding providers here
      
      default:
        throw new Error(`Unsupported embedding provider: ${this.config.embedModelProvider}`);
    }
    
    // Combine cached and new embeddings
    const result = [...cachedEmbeddings];
    
    for (let i = 0; i < textIndices.length; i++) {
      const index = textIndices[i];
      const text = textsToEmbed[i];
      const embedding = newEmbeddings[i];
      
      result[index] = embedding;
      
      // Cache the new embedding
      const hash = this.hashText(text);
      this.embeddingCache.set(hash, embedding);
    }
    
    return result;
  }
  
  /**
   * Create embeddings using OpenAI's API
   * 
   * @param {Array<string>} texts - Array of text to embed
   * @returns {Array<Array<number>>} Array of embeddings
   */
  async createOpenAIEmbeddings(texts) {
    if (!this.config.openaiApiKey) {
      throw new Error('OpenAI API key is required for embeddings');
    }
    
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          input: texts,
          model: this.config.embedModelName
        },
        {
          headers: {
            'Authorization': `Bearer ${this.config.openaiApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Extract embeddings from response
      const embeddings = response.data.data.map(item => item.embedding);
      
      logger.debug(`Created ${embeddings.length} embeddings with OpenAI`);
      
      return embeddings;
    } catch (error) {
      logger.error(`Error creating OpenAI embeddings: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Create a hash for text to use as cache key
   * 
   * @param {string} text - Text to hash
   * @returns {string} Hash string
   */
  hashText(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }
  
  /**
   * Index a document with metadata
   * 
   * @param {string} text - Text content to index
   * @param {Object} metadata - Metadata about the document
   * @returns {string} Document ID
   */
  async indexDocument(text, metadata = {}) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    try {
      // Generate a document ID if not provided
      const id = metadata.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create embedding
      const [embedding] = await this.createEmbeddings(text);
      
      // Upsert to vector database
      await this.upsertVector(id, embedding, {
        text: text.substring(0, 1000), // Store a preview of the text
        ...metadata
      });
      
      logger.debug(`Indexed document ${id} (${text.length} chars)`);
      this.emit('document:indexed', { id, metadata });
      
      return id;
    } catch (error) {
      logger.error(`Error indexing document: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Index a document by chunking it into smaller pieces
   * 
   * @param {string} text - Text content to index
   * @param {Object} metadata - Metadata about the document
   * @returns {Array<string>} Array of chunk IDs
   */
  async indexDocumentChunked(text, metadata = {}) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    try {
      // Generate a document ID if not provided
      const docId = metadata.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Split text into chunks
      const chunks = this.chunkText(text, this.config.chunkSize, this.config.chunkOverlap);
      
      logger.debug(`Split document into ${chunks.length} chunks`);
      
      // Create embeddings for all chunks
      const embeddings = await this.createEmbeddings(chunks);
      
      // Prepare vectors for upsert
      const vectors = chunks.map((chunk, i) => ({
        id: `${docId}_chunk_${i}`,
        values: embeddings[i],
        metadata: {
          text: chunk.substring(0, 1000), // Store a preview of the chunk
          docId,
          chunkIndex: i,
          chunkCount: chunks.length,
          ...metadata
        }
      }));
      
      // Upsert in batches to avoid request size limits
      const chunkIds = [];
      
      for (let i = 0; i < vectors.length; i += this.config.batchSize) {
        const batch = vectors.slice(i, i + this.config.batchSize);
        
        await this.upsertVectors(batch);
        
        chunkIds.push(...batch.map(v => v.id));
        
        logger.debug(`Upserted batch of ${batch.length} vectors`);
      }
      
      // Also index the document metadata without a vector
      await this.upsertMetadata(docId, {
        docId,
        chunkCount: chunks.length,
        chunkIds,
        textLength: text.length,
        ...metadata
      });
      
      logger.info(`Indexed chunked document ${docId} with ${chunks.length} chunks`);
      this.emit('document:chunked-indexed', { 
        docId, 
        chunkCount: chunks.length, 
        metadata 
      });
      
      return {
        docId,
        chunkIds
      };
    } catch (error) {
      logger.error(`Error indexing chunked document: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Chunk text into smaller pieces
   * 
   * @param {string} text - Text to chunk
   * @param {number} chunkSize - Size of each chunk
   * @param {number} overlap - Overlap between chunks
   * @returns {Array<string>} Array of chunks
   */
  chunkText(text, chunkSize, overlap) {
    const chunks = [];
    
    // Simple chunking by character count
    // In a production system, you would use a more sophisticated chunking strategy
    // that respects natural language boundaries
    
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
      const chunk = text.substring(i, i + chunkSize);
      
      if (chunk.length < 10) {
        // Skip very small chunks
        continue;
      }
      
      chunks.push(chunk);
    }
    
    return chunks;
  }
  
  /**
   * Upsert a single vector to the database
   * 
   * @param {string} id - Vector ID
   * @param {Array<number>} vector - Vector values
   * @param {Object} metadata - Vector metadata
   */
  async upsertVector(id, vector, metadata = {}) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    // Upsert based on the configured provider
    switch (this.config.provider) {
      case 'pinecone':
        await this.upsertPineconeVector(id, vector, metadata);
        break;
        
      case 'weaviate':
        await this.upsertWeaviateVector(id, vector, metadata);
        break;
        
      case 'qdrant':
        await this.upsertQdrantVector(id, vector, metadata);
        break;
        
      default:
        throw new Error(`Unsupported vector database provider: ${this.config.provider}`);
    }
  }
  
  /**
   * Upsert multiple vectors to the database
   * 
   * @param {Array<Object>} vectors - Array of vector objects
   */
  async upsertVectors(vectors) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    // Upsert based on the configured provider
    switch (this.config.provider) {
      case 'pinecone':
        await this.upsertPineconeVectors(vectors);
        break;
        
      case 'weaviate':
        await this.upsertWeaviateVectors(vectors);
        break;
        
      case 'qdrant':
        await this.upsertQdrantVectors(vectors);
        break;
        
      default:
        throw new Error(`Unsupported vector database provider: ${this.config.provider}`);
    }
  }
  
  /**
   * Upsert a single vector to Pinecone
   * 
   * @param {string} id - Vector ID
   * @param {Array<number>} vector - Vector values
   * @param {Object} metadata - Vector metadata
   */
  async upsertPineconeVector(id, vector, metadata = {}) {
    try {
      await this.index.upsert({
        upsertRequest: {
          vectors: [
            {
              id,
              values: vector,
              metadata
            }
          ],
          namespace: this.config.namespace
        }
      });
    } catch (error) {
      logger.error(`Error upserting vector to Pinecone: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Upsert multiple vectors to Pinecone
   * 
   * @param {Array<Object>} vectors - Array of vector objects
   */
  async upsertPineconeVectors(vectors) {
    try {
      await this.index.upsert({
        upsertRequest: {
          vectors,
          namespace: this.config.namespace
        }
      });
    } catch (error) {
      logger.error(`Error upserting vectors to Pinecone: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Upsert metadata without a vector (for document metadata)
   * 
   * @param {string} id - Document ID
   * @param {Object} metadata - Document metadata
   */
  async upsertMetadata(id, metadata) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    // Different providers have different ways of storing metadata without vectors
    switch (this.config.provider) {
      case 'pinecone':
        // For Pinecone, we create a zero vector with the metadata
        const zeroVector = new Array(this.config.dimensions).fill(0);
        await this.upsertVector(id, zeroVector, {
          ...metadata,
          _type: 'document_metadata'
        });
        break;
        
      // Add other providers here
        
      default:
        throw new Error(`Unsupported vector database provider: ${this.config.provider}`);
    }
  }
  
  /**
   * Search for similar vectors
   * 
   * @param {Array<number>} queryVector - Query vector
   * @param {Object} options - Search options
   * @returns {Array<Object>} Search results
   */
  async searchSimilar(queryVector, options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const searchOptions = {
      topK: options.topK || 10,
      filter: options.filter || {},
      includeMetadata: options.includeMetadata !== false,
      includeValues: options.includeValues || false,
      ...options
    };
    
    // Search based on the configured provider
    switch (this.config.provider) {
      case 'pinecone':
        return await this.searchPinecone(queryVector, searchOptions);
        
      case 'weaviate':
        return await this.searchWeaviate(queryVector, searchOptions);
        
      case 'qdrant':
        return await this.searchQdrant(queryVector, searchOptions);
        
      default:
        throw new Error(`Unsupported vector database provider: ${this.config.provider}`);
    }
  }
  
  /**
   * Search for documents similar to a text query
   * 
   * @param {string} text - Query text
   * @param {Object} options - Search options
   * @returns {Array<Object>} Search results
   */
  async searchByText(text, options = {}) {
    try {
      // Create embedding for the query text
      const [queryVector] = await this.createEmbeddings(text);
      
      // Search with the query vector
      return await this.searchSimilar(queryVector, options);
    } catch (error) {
      logger.error(`Error searching by text: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Search for documents by metadata
   * 
   * @param {Object} filter - Metadata filter
   * @param {Object} options - Search options
   * @returns {Array<Object>} Search results
   */
  async searchByMetadata(filter, options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    // Different providers have different ways of searching by metadata
    switch (this.config.provider) {
      case 'pinecone':
        // For Pinecone, we need to have a query vector even for metadata searches
        // We use a zero vector for this purpose
        const zeroVector = new Array(this.config.dimensions).fill(0);
        
        return await this.searchPinecone(zeroVector, {
          ...options,
          filter
        });
        
      // Add other providers here
        
      default:
        throw new Error(`Unsupported vector database provider: ${this.config.provider}`);
    }
  }
  
  /**
   * Search Pinecone for similar vectors
   * 
   * @param {Array<number>} queryVector - Query vector
   * @param {Object} options - Search options
   * @returns {Array<Object>} Search results
   */
  async searchPinecone(queryVector, options) {
    try {
      const response = await this.index.query({
        queryRequest: {
          vector: queryVector,
          topK: options.topK,
          includeMetadata: options.includeMetadata,
          includeValues: options.includeValues,
          filter: options.filter,
          namespace: this.config.namespace
        }
      });
      
      // Format the response
      return response.matches.map(match => ({
        id: match.id,
        score: match.score,
        metadata: match.metadata || {},
        values: match.values
      }));
    } catch (error) {
      logger.error(`Error searching Pinecone: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get a document by ID
   * 
   * @param {string} id - Document ID
   * @returns {Object} Document data
   */
  async getDocumentById(id) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    // Fetch based on the configured provider
    switch (this.config.provider) {
      case 'pinecone':
        return await this.getPineconeDocument(id);
        
      case 'weaviate':
        return await this.getWeaviateDocument(id);
        
      case 'qdrant':
        return await this.getQdrantDocument(id);
        
      default:
        throw new Error(`Unsupported vector database provider: ${this.config.provider}`);
    }
  }
  
  /**
   * Get a document from Pinecone
   * 
   * @param {string} id - Document ID
   * @returns {Object} Document data
   */
  async getPineconeDocument(id) {
    try {
      const response = await this.index.fetch({
        ids: [id],
        namespace: this.config.namespace
      });
      
      if (Object.keys(response.vectors).length === 0) {
        return null;
      }
      
      const vector = response.vectors[id];
      
      return {
        id,
        metadata: vector.metadata || {},
        values: vector.values
      };
    } catch (error) {
      logger.error(`Error fetching document from Pinecone: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get all chunks for a document
   * 
   * @param {string} docId - Document ID
   * @returns {Array<Object>} Chunks data
   */
  async getDocumentChunks(docId) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    try {
      // Search for chunks with this document ID
      const results = await this.searchByMetadata({
        docId: { $eq: docId }
      }, {
        topK: 1000, // Get all chunks
        includeValues: false
      });
      
      // Sort by chunk index
      results.sort((a, b) => 
        (a.metadata.chunkIndex || 0) - (b.metadata.chunkIndex || 0)
      );
      
      return results;
    } catch (error) {
      logger.error(`Error fetching document chunks: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Delete a document and all its chunks
   * 
   * @param {string} docId - Document ID
   * @returns {boolean} Success flag
   */
  async deleteDocument(docId) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    try {
      // First get the document metadata to find all chunks
      const metadata = await this.getDocumentById(docId);
      
      if (!metadata) {
        logger.warn(`Document ${docId} not found for deletion`);
        return false;
      }
      
      // Get all chunk IDs
      let chunkIds = [];
      
      if (metadata.metadata && metadata.metadata.chunkIds) {
        // If we have the chunk IDs in the metadata
        chunkIds = metadata.metadata.chunkIds;
      } else {
        // Otherwise search for chunks with this document ID
        const chunks = await this.getDocumentChunks(docId);
        chunkIds = chunks.map(chunk => chunk.id);
      }
      
      // Delete all chunks
      await this.deleteVectors([...chunkIds, docId]);
      
      logger.info(`Deleted document ${docId} with ${chunkIds.length} chunks`);
      this.emit('document:deleted', { docId, chunkCount: chunkIds.length });
      
      return true;
    } catch (error) {
      logger.error(`Error deleting document: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Delete vectors by ID
   * 
   * @param {Array<string>} ids - Vector IDs
   */
  async deleteVectors(ids) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    if (ids.length === 0) {
      return;
    }
    
    // Delete based on the configured provider
    switch (this.config.provider) {
      case 'pinecone':
        await this.deletePineconeVectors(ids);
        break;
        
      case 'weaviate':
        await this.deleteWeaviateVectors(ids);
        break;
        
      case 'qdrant':
        await this.deleteQdrantVectors(ids);
        break;
        
      default:
        throw new Error(`Unsupported vector database provider: ${this.config.provider}`);
    }
  }
  
  /**
   * Delete vectors from Pinecone
   * 
   * @param {Array<string>} ids - Vector IDs
   */
  async deletePineconeVectors(ids) {
    try {
      await this.index.delete1({
        ids,
        namespace: this.config.namespace
      });
    } catch (error) {
      logger.error(`Error deleting vectors from Pinecone: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Index code file with source information
   * 
   * @param {string} content - File content
   * @param {Object} fileInfo - File information
   * @returns {Object} Indexing result
   */
  async indexCodeFile(content, fileInfo) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    try {
      // Generate a file ID
      const fileId = fileInfo.id || 
        `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Prepare metadata
      const metadata = {
        ...fileInfo,
        fileId,
        fileType: fileInfo.fileType || this.detectFileType(fileInfo.fileName),
        indexedAt: Date.now()
      };
      
      // Index the file in chunks
      const result = await this.indexDocumentChunked(content, metadata);
      
      logger.info(`Indexed code file ${fileInfo.fileName} as ${fileId}`);
      
      return {
        fileId,
        ...result
      };
    } catch (error) {
      logger.error(`Error indexing code file: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Detect file type from file name
   * 
   * @param {string} fileName - File name
   * @returns {string} File type
   */
  detectFileType(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    
    // Map extensions to file types
    const fileTypeMap = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'rb': 'ruby',
      'php': 'php',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'json': 'json',
      'md': 'markdown',
      'yaml': 'yaml',
      'yml': 'yaml',
      'xml': 'xml',
      'sh': 'shell',
      'bat': 'batch',
      'sql': 'sql'
    };
    
    return fileTypeMap[extension] || 'text';
  }
  
  /**
   * Search for code examples
   * 
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Array<Object>} Search results
   */
  async searchCode(query, options = {}) {
    try {
      // Set code-specific options
      const codeOptions = {
        ...options,
        filter: {
          ...options.filter,
          // Filter out non-code documents if not otherwise specified
          fileType: options.fileType || { $exists: true }
        },
        topK: options.topK || 20
      };
      
      // Perform the search
      const results = await this.searchByText(query, codeOptions);
      
      // Group by file for better results
      return this.groupResultsByFile(results);
    } catch (error) {
      logger.error(`Error searching code: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Group search results by file
   * 
   * @param {Array<Object>} results - Search results
   * @returns {Array<Object>} Grouped results
   */
  groupResultsByFile(results) {
    const fileGroups = new Map();
    
    // Group chunks by file
    for (const result of results) {
      const fileId = result.metadata.fileId;
      
      if (!fileId) continue;
      
      if (!fileGroups.has(fileId)) {
        fileGroups.set(fileId, {
          fileId,
          fileName: result.metadata.fileName,
          fileType: result.metadata.fileType,
          projectId: result.metadata.projectId,
          chunks: [],
          bestScore: 0
        });
      }
      
      const fileGroup = fileGroups.get(fileId);
      
      // Add the chunk to the file group
      fileGroup.chunks.push({
        id: result.id,
        text: result.metadata.text,
        score: result.score,
        chunkIndex: result.metadata.chunkIndex || 0
      });
      
      // Update the best score for this file
      if (result.score > fileGroup.bestScore) {
        fileGroup.bestScore = result.score;
      }
    }
    
    // Sort chunks within each file by chunk index
    for (const fileGroup of fileGroups.values()) {
      fileGroup.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    }
    
    // Convert to array and sort by best score
    return Array.from(fileGroups.values())
      .sort((a, b) => b.bestScore - a.bestScore);
  }
  
  /**
   * Get DB statistics
   * 
   * @returns {Object} Database statistics
   */
  async getStats() {
    if (!this.isConnected) {
      await this.connect();
    }
    
    try {
      // Get stats based on the configured provider
      switch (this.config.provider) {
        case 'pinecone':
          return await this.getPineconeStats();
          
        case 'weaviate':
          return await this.getWeaviateStats();
          
        case 'qdrant':
          return await this.getQdrantStats();
          
        default:
          throw new Error(`Unsupported vector database provider: ${this.config.provider}`);
      }
    } catch (error) {
      logger.error(`Error getting stats: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get Pinecone database statistics
   * 
   * @returns {Object} Database statistics
   */
  async getPineconeStats() {
    try {
      const stats = await this.index.describeIndexStats({
        describeIndexStatsRequest: {
          filter: {},
          namespace: this.config.namespace
        }
      });
      
      return {
        vectorCount: stats.totalVectorCount,
        dimensionCount: stats.dimension,
        namespaces: stats.namespaces,
        indexFullness: stats.indexFullness
      };
    } catch (error) {
      logger.error(`Error getting Pinecone stats: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Disconnect from the database
   */
  async disconnect() {
    if (!this.isConnected) {
      return;
    }
    
    try {
      // Different providers have different disconnect methods
      this.client = null;
      this.index = null;
      this.isConnected = false;
      
      // Clear the embedding cache
      this.embeddingCache.clear();
      
      logger.info('Disconnected from vector database');
      this.emit('disconnected');
      
      return true;
    } catch (error) {
      logger.error(`Error disconnecting from vector database: ${error.message}`);
      throw error;
    }
  }
}

module.exports = VectorDB;
