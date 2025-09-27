/**
 * Code Embeddings for the Agentic Software Development Swarm
 * 
 * This module analyzes and creates embeddings for code to enable
 * semantic understanding of codebases.
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../../utils/logger');
const VectorDB = require('./vector-db');

class CodeEmbeddings extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      enabled: config.enabled !== false,
      chunkSize: config.chunkSize || 1000,
      chunkOverlap: config.chunkOverlap || 200,
      supportedLanguages: config.supportedLanguages || [
        'javascript', 'typescript', 'python', 'java', 'c', 'cpp',
        'csharp', 'go', 'rust', 'ruby', 'php', 'html', 'css', 'scss',
        'jsx', 'tsx', 'vue', 'svelte', 'sql', 'shell'
      ],
      includeComments: config.includeComments !== false,
      extractFunctions: config.extractFunctions !== false,
      extractClasses: config.extractClasses !== false,
      batchSize: config.batchSize || 10,
      semanticTreeDepth: config.semanticTreeDepth || 3,
      cacheEnabled: config.cacheEnabled !== false,
      cacheTTL: config.cacheTTL || 3600000, // 1 hour
      ...config
    };
    
    // Initialize vector database
    this.vectorDb = new VectorDB(config.vectorDb || {});
    
    // File cache
    this.fileCache = new Map();
    
    logger.info('Code Embeddings initialized');
    logger.debug(`Code Embeddings configuration: ${JSON.stringify({
      ...this.config,
      vectorDb: 'configured' // Don't log the entire vectorDb config
    })}`);
  }
  
  /**
   * Initialize the code embeddings module
   */
  async initialize() {
    try {
      // Connect to vector database
      await this.vectorDb.connect();
      
      logger.info('Code Embeddings initialized');
      this.emit('initialized');
      
      return true;
    } catch (error) {
      logger.error(`Failed to initialize Code Embeddings: ${error.message}`);
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Index a code file
   * 
   * @param {string} filePath - Path to the file
   * @param {string} content - File content
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Indexing result
   */
  async indexCodeFile(filePath, content, metadata = {}) {
    if (!this.config.enabled) {
      throw new Error('Code Embeddings is disabled');
    }
    
    try {
      const extension = path.extname(filePath).substring(1).toLowerCase();
      const language = this.detectLanguage(filePath);
      
      if (!language) {
        logger.warn(`Unsupported language for file: ${filePath}`);
        return null;
      }
      
      // Prepare metadata
      const fileMetadata = {
        filePath,
        language,
        extension,
        fileName: path.basename(filePath),
        dir: path.dirname(filePath),
        lines: content.split('\n').length,
        size: content.length,
        ...metadata
      };
      
      // Update cache
      this.updateFileCache(filePath, content, fileMetadata);
      
      // Index whole file
      const fileId = await this.vectorDb.indexCodeFile(content, fileMetadata);
      
      // Extract and index semantic elements
      const semanticElements = await this.extractSemanticElements(content, language);
      
      // Index each semantic element
      const elementIds = [];
      
      for (const element of semanticElements) {
        try {
          // Index the element
          const elementId = await this.vectorDb.indexDocument(element.content, {
            ...fileMetadata,
            elementType: element.type,
            elementName: element.name,
            lineStart: element.lineStart,
            lineEnd: element.lineEnd,
            parentFile: filePath,
            parentFileId: fileId.fileId,
            parentElement: element.parentName || null,
            parentElementType: element.parentType || null,
            isSemanticElement: true
          });
          
          elementIds.push(elementId);
        } catch (error) {
          logger.error(`Error indexing semantic element in ${filePath}: ${error.message}`);
          // Continue with other elements
        }
      }
      
      logger.info(`Indexed code file ${filePath} with ${semanticElements.length} semantic elements`);
      this.emit('file:indexed', {
        filePath,
        fileId: fileId.fileId,
        elements: semanticElements.length,
        language
      });
      
      return {
        fileId: fileId.fileId,
        elementIds,
        elements: semanticElements.length,
        language
      };
    } catch (error) {
      logger.error(`Error indexing code file ${filePath}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Index a directory of code files
   * 
   * @param {string} dirPath - Path to the directory
   * @param {Object} options - Indexing options
   * @returns {Object} Indexing result
   */
  async indexDirectory(dirPath, options = {}) {
    if (!this.config.enabled) {
      throw new Error('Code Embeddings is disabled');
    }
    
    const indexOptions = {
      recursive: options.recursive !== false,
      extensions: options.extensions || null,
      exclude: options.exclude || [],
      batchSize: options.batchSize || this.config.batchSize,
      projectName: options.projectName || path.basename(dirPath),
      projectMetadata: options.projectMetadata || {},
      ...options
    };
    
    try {
      // Collect all files to index
      const filesToIndex = await this.collectFiles(dirPath, indexOptions);
      
      logger.info(`Found ${filesToIndex.length} files to index in ${dirPath}`);
      
      // Index files in batches
      const results = {
        totalFiles: filesToIndex.length,
        indexedFiles: 0,
        failedFiles: 0,
        languages: {},
        fileIds: []
      };
      
      for (let i = 0; i < filesToIndex.length; i += indexOptions.batchSize) {
        const batch = filesToIndex.slice(i, i + indexOptions.batchSize);
        
        // Process batch in parallel
        const batchResults = await Promise.allSettled(
          batch.map(async (file) => {
            try {
              // Read file content
              const content = await fs.readFile(file, 'utf8');
              
              // Index file
              const result = await this.indexCodeFile(file, content, {
                projectName: indexOptions.projectName,
                projectRoot: dirPath,
                ...indexOptions.projectMetadata
              });
              
              return { file, success: true, result };
            } catch (error) {
              logger.error(`Error indexing file ${file}: ${error.message}`);
              return { file, success: false, error: error.message };
            }
          })
        );
        
        // Process batch results
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            const value = result.value;
            
            if (value.success && value.result) {
              results.indexedFiles++;
              results.fileIds.push(value.result.fileId);
              
              // Update language stats
              if (!results.languages[value.result.language]) {
                results.languages[value.result.language] = 0;
              }
              results.languages[value.result.language]++;
            } else {
              results.failedFiles++;
            }
          } else {
            results.failedFiles++;
          }
        }
        
        // Log progress
        logger.info(`Indexed batch of ${batch.length} files, progress: ${Math.min(i + batch.length, filesToIndex.length)}/${filesToIndex.length}`);
      }
      
      logger.info(`Completed indexing ${results.indexedFiles} files in ${dirPath}`);
      this.emit('directory:indexed', {
        dirPath,
        ...results
      });
      
      return results;
    } catch (error) {
      logger.error(`Error indexing directory ${dirPath}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Collect files to index from a directory
   * 
   * @param {string} dirPath - Path to the directory
   * @param {Object} options - Collection options
   * @returns {Array<string>} Array of file paths
   */
  async collectFiles(dirPath, options) {
    const files = [];
    
    // Helper function to check if path should be excluded
    const isExcluded = (path) => {
      return options.exclude.some(pattern => {
        if (pattern.startsWith('/')) {
          // Absolute path within project
          const normalizedPattern = pattern.substring(1);
          return path.endsWith(normalizedPattern);
        } else if (pattern.includes('*')) {
          // Simple glob pattern, just check parts
          const parts = pattern.split('*');
          return parts.every(part => path.includes(part));
        } else {
          // Simple string match
          return path.includes(pattern);
        }
      });
    };
    
    // Helper function to check if file should be included
    const shouldIncludeFile = (file) => {
      // Check if excluded
      if (isExcluded(file)) {
        return false;
      }
      
      // Check extension
      const extension = path.extname(file).substring(1).toLowerCase();
      
      if (options.extensions) {
        return options.extensions.includes(extension);
      }
      
      // Default to supported languages
      const language = this.detectLanguage(file);
      return !!language;
    };
    
    // Helper function to recursively collect files
    const collectFromDir = async (dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            // Check if directory should be excluded
            if (!isExcluded(fullPath) && options.recursive) {
              await collectFromDir(fullPath);
            }
          } else if (entry.isFile()) {
            // Check if file should be included
            if (shouldIncludeFile(fullPath)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        logger.error(`Error reading directory ${dir}: ${error.message}`);
        // Continue with other directories
      }
    };
    
    // Start collection
    await collectFromDir(dirPath);
    
    return files;
  }
  
  /**
   * Extract semantic elements from code
   * 
   * @param {string} content - File content
   * @param {string} language - Programming language
   * @returns {Array<Object>} Extracted elements
   */
  async extractSemanticElements(content, language) {
    // This is a simplified version - in a real implementation,
    // you would use language-specific parsers like Babel, TypeScript, etc.
    const elements = [];
    
    try {
      const lines = content.split('\n');
      
      // Extract functions and methods
      if (this.config.extractFunctions) {
        elements.push(...this.extractFunctions(content, language, lines));
      }
      
      // Extract classes
      if (this.config.extractClasses) {
        elements.push(...this.extractClasses(content, language, lines));
      }
      
      return elements;
    } catch (error) {
      logger.error(`Error extracting semantic elements: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Extract functions from code
   * 
   * @param {string} content - File content
   * @param {string} language - Programming language
   * @param {Array<string>} lines - Lines of code
   * @returns {Array<Object>} Extracted functions
   */
  extractFunctions(content, language, lines) {
    const functions = [];
    
    // This is a simplified regex-based extractor
    // In a real implementation, you would use a proper parser
    let regex;
    
    switch (language) {
      case 'javascript':
      case 'typescript':
        // Match both function declarations and arrow functions
        regex = /function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)|const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g;
        break;
        
      case 'python':
        regex = /def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
        break;
        
      case 'java':
      case 'csharp':
      case 'cpp':
        regex = /(?:public|private|protected|static|final|abstract)?\s+\w+\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
        break;
        
      default:
        return []; // Unsupported language for function extraction
    }
    
    let match;
    while ((match = regex.exec(content)) !== null) {
      // Find function bounds (this is very simplified)
      const funcStart = content.indexOf(match[0]);
      let openBraces = 0;
      let funcEnd = funcStart;
      
      // Simple brace matching to find function end
      for (let i = funcStart; i < content.length; i++) {
        if (content[i] === '{') {
          openBraces++;
        } else if (content[i] === '}') {
          openBraces--;
          if (openBraces === 0 && i > funcStart) {
            funcEnd = i + 1;
            break;
          }
        }
      }
      
      // Calculate line numbers
      const lineStart = content.substring(0, funcStart).split('\n').length;
      const lineEnd = content.substring(0, funcEnd).split('\n').length;
      
      // Extract function content
      const functionContent = content.substring(funcStart, funcEnd);
      
      // Get function name
      const name = match[1] || match[3] || 'anonymous';
      
      functions.push({
        type: 'function',
        name,
        content: functionContent,
        lineStart,
        lineEnd,
        params: (match[2] || match[4] || '').trim().split(',').map(p => p.trim())
      });
    }
    
    return functions;
  }
  
  /**
   * Extract classes from code
   * 
   * @param {string} content - File content
   * @param {string} language - Programming language
   * @param {Array<string>} lines - Lines of code
   * @returns {Array<Object>} Extracted classes
   */
  extractClasses(content, language, lines) {
    const classes = [];
    
    // This is a simplified regex-based extractor
    let regex;
    
    switch (language) {
      case 'javascript':
      case 'typescript':
        regex = /class\s+([a-zA-Z0-9_$]+)(?:\s+extends\s+([a-zA-Z0-9_$.]+))?/g;
        break;
        
      case 'python':
        regex = /class\s+([a-zA-Z0-9_]+)(?:\(([^)]+)\))?:/g;
        break;
        
      case 'java':
      case 'csharp':
      case 'cpp':
        regex = /(?:public|private|protected|static|abstract)?\s+class\s+([a-zA-Z0-9_]+)(?:\s+(?:extends|:)\s+([a-zA-Z0-9_]+))?/g;
        break;
        
      default:
        return []; // Unsupported language for class extraction
    }
    
    let match;
    while ((match = regex.exec(content)) !== null) {
      // Find class bounds (this is very simplified)
      const classStart = content.indexOf(match[0]);
      let openBraces = 0;
      let classEnd = classStart;
      
      // Simple brace matching to find class end
      for (let i = classStart; i < content.length; i++) {
        if (content[i] === '{') {
          openBraces++;
        } else if (content[i] === '}') {
          openBraces--;
          if (openBraces === 0 && i > classStart) {
            classEnd = i + 1;
            break;
          }
        }
      }
      
      // Calculate line numbers
      const lineStart = content.substring(0, classStart).split('\n').length;
      const lineEnd = content.substring(0, classEnd).split('\n').length;
      
      // Extract class content
      const classContent = content.substring(classStart, classEnd);
      
      // Get class name and parent class
      const name = match[1];
      const parent = match[2];
      
      classes.push({
        type: 'class',
        name,
        parent,
        content: classContent,
        lineStart,
        lineEnd
      });
      
      // Extract methods within the class
      const methods = this.extractMethods(classContent, language, lineStart);
      
      // Add methods as elements with class as parent
      for (const method of methods) {
        method.parentName = name;
        method.parentType = 'class';
      }
      
      classes.push(...methods);
    }
    
    return classes;
  }
  
  /**
   * Extract methods from class code
   * 
   * @param {string} content - Class content
   * @param {string} language - Programming language
   * @param {number} lineOffset - Line number offset
   * @returns {Array<Object>} Extracted methods
   */
  extractMethods(content, language, lineOffset) {
    const methods = [];
    
    // This is a simplified regex-based extractor
    let regex;
    
    switch (language) {
      case 'javascript':
      case 'typescript':
        // Match class methods
        regex = /(?:async\s+)?([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*{/g;
        break;
        
      case 'python':
        regex = /def\s+([a-zA-Z0-9_]+)\s*\(self(?:,\s*([^)]*))?\)/g;
        break;
        
      case 'java':
      case 'csharp':
      case 'cpp':
        regex = /(?:public|private|protected|static|final|abstract)?\s+\w+\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
        break;
        
      default:
        return []; // Unsupported language for method extraction
    }
    
    let match;
    while ((match = regex.exec(content)) !== null) {
      // Skip constructor
      if (match[1] === 'constructor') {
        continue;
      }
      
      // Find method bounds (this is very simplified)
      const methodStart = content.indexOf(match[0]);
      let openBraces = 0;
      let methodEnd = methodStart;
      
      // Simple brace matching to find method end
      for (let i = methodStart; i < content.length; i++) {
        if (content[i] === '{') {
          openBraces++;
        } else if (content[i] === '}') {
          openBraces--;
          if (openBraces === 0 && i > methodStart) {
            methodEnd = i + 1;
            break;
          }
        }
      }
      
      // Calculate line numbers (add offset for class position)
      const lineStart = lineOffset + content.substring(0, methodStart).split('\n').length - 1;
      const lineEnd = lineOffset + content.substring(0, methodEnd).split('\n').length - 1;
      
      // Extract method content
      const methodContent = content.substring(methodStart, methodEnd);
      
      // Get method name
      const name = match[1];
      
      methods.push({
        type: 'method',
        name,
        content: methodContent,
        lineStart,
        lineEnd,
        params: (match[2] || '').trim().split(',').map(p => p.trim())
      });
    }
    
    return methods;
  }
  
  /**
   * Detect the language of a file
   * 
   * @param {string} filePath - Path to the file
   * @returns {string|null} Detected language or null if unsupported
   */
  detectLanguage(filePath) {
    const extension = path.extname(filePath).substring(1).toLowerCase();
    
    // Map extensions to languages
    const extensionToLanguage = {
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
    
    const language = extensionToLanguage[extension];
    
    // Check if language is supported
    if (language && this.config.supportedLanguages.includes(language)) {
      return language;
    }
    
    return null;
  }
  
  /**
   * Update the file cache
   * 
   * @param {string} filePath - Path to the file
   * @param {string} content - File content
   * @param {Object} metadata - File metadata
   */
  updateFileCache(filePath, content, metadata) {
    if (!this.config.cacheEnabled) {
      return;
    }
    
    this.fileCache.set(filePath, {
      content,
      metadata,
      timestamp: Date.now(),
      ttl: this.config.cacheTTL
    });
    
    // Clean up old cache entries
    this.cleanupCache();
  }
  
  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    if (!this.config.cacheEnabled) {
      return;
    }
    
    const now = Date.now();
    
    for (const [filePath, entry] of this.fileCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.fileCache.delete(filePath);
      }
    }
  }
  
  /**
   * Search for code by query
   * 
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Array<Object>} Search results
   */
  async searchCode(query, options = {}) {
    if (!this.config.enabled) {
      throw new Error('Code Embeddings is disabled');
    }
    
    try {
      // Set code-specific options
      const codeOptions = {
        ...options,
        filter: {
          ...options.filter,
          // Filter for code files or elements
          $or: [
            { language: { $exists: true } },
            { elementType: { $exists: true } }
          ]
        }
      };
      
      // Perform the search
      const results = await this.vectorDb.searchByText(query, codeOptions);
      
      return this.formatSearchResults(results);
    } catch (error) {
      logger.error(`Error searching code: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Search for similar code
   * 
   * @param {string} codeSnippet - Code snippet to search for
   * @param {string} language - Programming language
   * @param {Object} options - Search options
   * @returns {Array<Object>} Search results
   */
  async searchSimilarCode(codeSnippet, language, options = {}) {
    if (!this.config.enabled) {
      throw new Error('Code Embeddings is disabled');
    }
    
    try {
      // Set code-specific options
      const codeOptions = {
        ...options,
        filter: {
          ...options.filter,
          // Filter for specific language
          language: { $eq: language }
        }
      };
      
      // Perform the search
      const results = await this.vectorDb.searchByText(codeSnippet, codeOptions);
      
      return this.formatSearchResults(results);
    } catch (error) {
      logger.error(`Error searching similar code: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Format search results
   * 
   * @param {Array<Object>} results - Raw search results
   * @returns {Array<Object>} Formatted results
   */
  formatSearchResults(results) {
    // Group by file
    const fileResults = new Map();
    
    for (const result of results) {
      const metadata = result.metadata;
      
      // Skip results without metadata
      if (!metadata) continue;
      
      // Check if result is a file or element
      if (metadata.elementType) {
        // This is a semantic element (function, class, etc.)
        const fileKey = metadata.parentFile || metadata.filePath;
        
        if (!fileResults.has(fileKey)) {
          fileResults.set(fileKey, {
            file: {
              filePath: fileKey,
              fileName: metadata.fileName || path.basename(fileKey),
              language: metadata.language,
              score: result.score // Use the first element's score for the file
            },
            elements: []
          });
        }
        
        fileResults.get(fileKey).elements.push({
          type: metadata.elementType,
          name: metadata.elementName,
          lineStart: metadata.lineStart,
          lineEnd: metadata.lineEnd,
          snippet: result.metadata.text, // Preview snippet
          parentElement: metadata.parentElement,
          parentElementType: metadata.parentElementType,
          score: result.score
        });
      } else {
        // This is a file
        const fileKey = metadata.filePath;
        
        if (!fileResults.has(fileKey)) {
          fileResults.set(fileKey, {
            file: {
              filePath: fileKey,
              fileName: metadata.fileName || path.basename(fileKey),
              language: metadata.language,
              score: result.score
            },
            elements: []
          });
        } else {
          // Update file score if this score is higher
          if (result.score > fileResults.get(fileKey).file.score) {
            fileResults.get(fileKey).file.score = result.score;
          }
        }
      }
    }
    
    // Convert to array and sort by score
    return Array.from(fileResults.values())
      .sort((a, b) => b.file.score - a.file.score);
  }
  
  /**
   * Generate a semantic tree for a file
   * 
   * @param {string} filePath - Path to the file
   * @returns {Object} Semantic tree
   */
  async generateSemanticTree(filePath) {
    try {
      // Get file content
      let content;
      let metadata;
      
      if (this.fileCache.has(filePath)) {
        const cacheEntry = this.fileCache.get(filePath);
        content = cacheEntry.content;
        metadata = cacheEntry.metadata;
      } else {
        content = await fs.readFile(filePath, 'utf8');
        metadata = {
          filePath,
          language: this.detectLanguage(filePath),
          fileName: path.basename(filePath)
        };
      }
      
      if (!metadata.language) {
        throw new Error(`Unsupported language for file: ${filePath}`);
      }
      
      // Extract semantic elements
      const elements = await this.extractSemanticElements(content, metadata.language);
      
      // Build a tree structure
      const tree = {
        type: 'file',
        name: metadata.fileName,
        language: metadata.language,
        path: filePath,
        children: []
      };
      
      // Group elements by parent
      const elementsByParent = new Map();
      elementsByParent.set(null, []); // Root elements
      
      // First pass: organize elements by parent
      for (const element of elements) {
        const parentName = element.parentName || null;
        
        if (!elementsByParent.has(parentName)) {
          elementsByParent.set(parentName, []);
        }
        
        elementsByParent.get(parentName).push(element);
      }
      
      // Second pass: recursively build the tree
      const buildTree = (parentName, depth) => {
        // Limit recursion depth
        if (depth > this.config.semanticTreeDepth) {
          return [];
        }
        
        const children = elementsByParent.get(parentName) || [];
        
        return children.map(element => ({
          type: element.type,
          name: element.name,
          lineStart: element.lineStart,
          lineEnd: element.lineEnd,
          params: element.params,
          children: buildTree(element.name, depth + 1)
        }));
      };
      
      // Build the tree starting from root elements
      tree.children = buildTree(null, 1);
      
      return tree;
    } catch (error) {
      logger.error(`Error generating semantic tree for ${filePath}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Clean up resources
   */
  async shutdown() {
    try {
      // Clear cache
      this.fileCache.clear();
      
      // Disconnect from vector database
      await this.vectorDb.disconnect();
      
      logger.info('Code Embeddings shut down');
    } catch (error) {
      logger.error(`Error shutting down Code Embeddings: ${error.message}`);
      throw error;
    }
  }
}

module.exports = CodeEmbeddings;
