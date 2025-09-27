/**
 * Shared State for the Agentic Software Development Swarm
 * 
 * This module provides a shared state mechanism for agents to communicate
 * and maintain context across the swarm.
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');
const MessageQueue = require('./message-queue');

class SharedState extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      updateFrequency: config.updateFrequency || 5000, // 5 seconds
      stateUpdateTopic: config.stateUpdateTopic || 'state-updates',
      stateSyncTopic: config.stateSyncTopic || 'state-sync',
      stateQueryTopic: config.stateQueryTopic || 'state-queries',
      changeTracking: config.changeTracking !== false,
      changeHistory: config.changeHistory || 50, // Keep last 50 changes
      persistToStorage: config.persistToStorage || false,
      storageAdapter: config.storageAdapter || null,
      lockTimeout: config.lockTimeout || 10000, // 10 seconds
      ...config
    };
    
    // Initialize state store
    this.state = {};
    this.locks = new Map();
    this.changeLog = [];
    this.subscribers = new Map();
    this.pendingUpdates = new Map();
    
    // Message queue for communication
    this.messageQueue = new MessageQueue(config.messageQueue || {});
    
    // Keep track of update channels
    this.updateChannel = null;
    this.syncChannel = null;
    this.queryChannel = null;
    
    // Track node information
    this.nodeId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.isInitialized = false;
    
    logger.info('Shared State initialized');
    logger.debug(`Shared State configuration: ${JSON.stringify(this.config)}`);
  }
  
  /**
   * Initialize the shared state
   */
  async initialize() {
    if (this.isInitialized) {
      logger.warn('Shared State already initialized');
      return;
    }
    
    try {
      // Connect to message queue
      await this.messageQueue.connect();
      
      // Set up update channel
      this.updateChannel = await this.messageQueue.createBroadcastChannel(
        this.config.stateUpdateTopic
      );
      
      // Subscribe to updates
      await this.updateChannel.subscribe(
        this.nodeId,
        this.handleStateUpdate.bind(this)
      );
      
      // Set up sync channel
      this.syncChannel = await this.messageQueue.createBroadcastChannel(
        this.config.stateSyncTopic
      );
      
      // Subscribe to sync requests
      await this.syncChannel.subscribe(
        this.nodeId,
        this.handleSyncRequest.bind(this)
      );
      
      // Set up query channel
      this.queryChannel = await this.messageQueue.createRequestResponse(
        this.config.stateQueryTopic
      );
      
      // Handle state queries
      await this.queryChannel.handleRequests(this.handleStateQuery.bind(this));
      
      // Load state from storage if enabled
      if (this.config.persistToStorage && this.config.storageAdapter) {
        await this.loadFromStorage();
      }
      
      // Request initial state sync
      await this.requestStateSync();
      
      this.isInitialized = true;
      
      logger.info(`Shared State initialized with node ID ${this.nodeId}`);
      this.emit('initialized', { nodeId: this.nodeId });
      
      return true;
    } catch (error) {
      logger.error(`Failed to initialize Shared State: ${error.message}`);
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Load state from storage
   */
  async loadFromStorage() {
    if (!this.config.storageAdapter) {
      logger.warn('No storage adapter configured, skipping load');
      return;
    }
    
    try {
      logger.info('Loading state from storage');
      
      const storedState = await this.config.storageAdapter.load();
      
      if (storedState) {
        this.state = storedState;
        logger.info('Successfully loaded state from storage');
      } else {
        logger.info('No state found in storage');
      }
    } catch (error) {
      logger.error(`Failed to load state from storage: ${error.message}`);
      // Continue with empty state
    }
  }
  
  /**
   * Save state to storage
   */
  async saveToStorage() {
    if (!this.config.persistToStorage || !this.config.storageAdapter) {
      return;
    }
    
    try {
      await this.config.storageAdapter.save(this.state);
      logger.debug('State saved to storage');
    } catch (error) {
      logger.error(`Failed to save state to storage: ${error.message}`);
    }
  }
  
  /**
   * Request a full state sync from other nodes
   */
  async requestStateSync() {
    try {
      logger.info('Requesting state sync from other nodes');
      
      await this.syncChannel.broadcast({
        type: 'sync-request',
        nodeId: this.nodeId,
        timestamp: Date.now()
      });
      
      // Set up a timeout to ensure we continue even if no response
      setTimeout(() => {
        if (Object.keys(this.state).length === 0) {
          logger.info('No state sync response received, continuing with empty state');
          this.emit('sync-completed', { empty: true });
        }
      }, 5000);
    } catch (error) {
      logger.error(`Failed to request state sync: ${error.message}`);
    }
  }
  
  /**
   * Handle incoming state update
   * 
   * @param {Object} update - State update message
   * @param {Object} metadata - Message metadata
   */
  async handleStateUpdate(update, metadata) {
    // Ignore our own updates
    if (update.sourceNodeId === this.nodeId) {
      return;
    }
    
    logger.debug(`Received state update from node ${update.sourceNodeId}`);
    
    try {
      // Apply the update
      this.applyRemoteUpdate(update.path, update.value, update.operation, update.metadata);
      
      // Record in change log if tracking enabled
      if (this.config.changeTracking) {
        this.recordChange({
          path: update.path,
          value: update.value,
          operation: update.operation,
          timestamp: update.timestamp,
          sourceNodeId: update.sourceNodeId,
          metadata: update.metadata
        });
      }
      
      // Save to storage if enabled
      if (this.config.persistToStorage && this.config.storageAdapter) {
        await this.saveToStorage();
      }
      
      // Notify local subscribers
      this.notifySubscribers(update.path, update.value, update.operation);
    } catch (error) {
      logger.error(`Error handling state update: ${error.message}`);
    }
  }
  
  /**
   * Handle sync request
   * 
   * @param {Object} request - Sync request message
   * @param {Object} metadata - Message metadata
   */
  async handleSyncRequest(request, metadata) {
    // Ignore our own requests
    if (request.nodeId === this.nodeId) {
      return;
    }
    
    logger.debug(`Received sync request from node ${request.nodeId}`);
    
    try {
      // Send our current state
      await this.syncChannel.broadcast({
        type: 'sync-response',
        targetNodeId: request.nodeId,
        sourceNodeId: this.nodeId,
        state: this.state,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error handling sync request: ${error.message}`);
    }
  }
  
  /**
   * Handle sync response
   * 
   * @param {Object} response - Sync response message
   * @param {Object} metadata - Message metadata
   */
  async handleSyncResponse(response, metadata) {
    // Ignore if not targeted at us
    if (response.targetNodeId !== this.nodeId) {
      return;
    }
    
    logger.info(`Received sync response from node ${response.sourceNodeId}`);
    
    // Only apply if we don't already have state
    if (Object.keys(this.state).length === 0) {
      this.state = response.state;
      
      logger.info('Applied synced state from other node');
      this.emit('sync-completed', { empty: false, sourceNodeId: response.sourceNodeId });
      
      // Save to storage if enabled
      if (this.config.persistToStorage && this.config.storageAdapter) {
        await this.saveToStorage();
      }
    }
  }
  
  /**
   * Handle state query
   * 
   * @param {Object} query - Query object
   * @param {Object} metadata - Query metadata
   * @returns {Object} Query response
   */
  async handleStateQuery(query, metadata) {
    logger.debug(`Received state query: ${JSON.stringify(query)}`);
    
    try {
      if (query.type === 'get') {
        // Handle 'get' query
        const value = this.get(query.path);
        
        return {
          success: true,
          path: query.path,
          value,
          timestamp: Date.now(),
          nodeId: this.nodeId
        };
      } else if (query.type === 'exists') {
        // Handle 'exists' query
        const exists = this.has(query.path);
        
        return {
          success: true,
          path: query.path,
          exists,
          timestamp: Date.now(),
          nodeId: this.nodeId
        };
      } else if (query.type === 'keys') {
        // Handle 'keys' query
        const keys = this.getKeys(query.path);
        
        return {
          success: true,
          path: query.path,
          keys,
          timestamp: Date.now(),
          nodeId: this.nodeId
        };
      } else {
        return {
          success: false,
          error: `Unsupported query type: ${query.type}`,
          timestamp: Date.now(),
          nodeId: this.nodeId
        };
      }
    } catch (error) {
      logger.error(`Error handling state query: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        timestamp: Date.now(),
        nodeId: this.nodeId
      };
    }
  }
  
  /**
   * Set a value in the shared state
   * 
   * @param {string|Array} path - Path to the value
   * @param {any} value - Value to set
   * @param {Object} metadata - Optional metadata
   * @returns {boolean} Success flag
   */
  async set(path, value, metadata = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    const normalizedPath = this.normalizePath(path);
    
    try {
      // Apply locally
      this.applyLocalUpdate(normalizedPath, value, 'set', metadata);
      
      // Broadcast update
      await this.broadcastUpdate(normalizedPath, value, 'set', metadata);
      
      // Save to storage if enabled
      if (this.config.persistToStorage && this.config.storageAdapter) {
        await this.saveToStorage();
      }
      
      // Notify local subscribers
      this.notifySubscribers(normalizedPath, value, 'set');
      
      logger.debug(`Set value at path ${normalizedPath}`);
      
      return true;
    } catch (error) {
      logger.error(`Failed to set value at ${normalizedPath}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get a value from the shared state
   * 
   * @param {string|Array} path - Path to the value
   * @returns {any} Retrieved value or undefined if not found
   */
  get(path) {
    const normalizedPath = this.normalizePath(path);
    
    if (normalizedPath.length === 0) {
      return this.state;
    }
    
    let current = this.state;
    
    for (let i = 0; i < normalizedPath.length; i++) {
      if (current === undefined || current === null) {
        return undefined;
      }
      
      current = current[normalizedPath[i]];
    }
    
    return current;
  }
  
  /**
   * Check if a path exists in the shared state
   * 
   * @param {string|Array} path - Path to check
   * @returns {boolean} True if path exists
   */
  has(path) {
    const normalizedPath = this.normalizePath(path);
    
    if (normalizedPath.length === 0) {
      return true; // Root always exists
    }
    
    let current = this.state;
    
    for (let i = 0; i < normalizedPath.length - 1; i++) {
      if (current === undefined || current === null) {
        return false;
      }
      
      current = current[normalizedPath[i]];
    }
    
    return current !== undefined && 
           current !== null && 
           Object.prototype.hasOwnProperty.call(current, normalizedPath[normalizedPath.length - 1]);
  }
  
  /**
   * Delete a value from the shared state
   * 
   * @param {string|Array} path - Path to delete
   * @param {Object} metadata - Optional metadata
   * @returns {boolean} Success flag
   */
  async delete(path, metadata = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    const normalizedPath = this.normalizePath(path);
    
    try {
      // Apply locally
      this.applyLocalUpdate(normalizedPath, undefined, 'delete', metadata);
      
      // Broadcast update
      await this.broadcastUpdate(normalizedPath, undefined, 'delete', metadata);
      
      // Save to storage if enabled
      if (this.config.persistToStorage && this.config.storageAdapter) {
        await this.saveToStorage();
      }
      
      // Notify local subscribers
      this.notifySubscribers(normalizedPath, undefined, 'delete');
      
      logger.debug(`Deleted value at path ${normalizedPath}`);
      
      return true;
    } catch (error) {
      logger.error(`Failed to delete value at ${normalizedPath}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Update a value in the shared state using a function
   * 
   * @param {string|Array} path - Path to the value
   * @param {Function} updateFn - Update function (receives current value, returns new value)
   * @param {Object} metadata - Optional metadata
   * @returns {boolean} Success flag
   */
  async update(path, updateFn, metadata = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    const normalizedPath = this.normalizePath(path);
    
    try {
      // Get the current value
      const currentValue = this.get(normalizedPath);
      
      // Calculate the new value
      const newValue = updateFn(currentValue);
      
      // Apply locally
      this.applyLocalUpdate(normalizedPath, newValue, 'update', metadata);
      
      // Broadcast update
      await this.broadcastUpdate(normalizedPath, newValue, 'update', metadata);
      
      // Save to storage if enabled
      if (this.config.persistToStorage && this.config.storageAdapter) {
        await this.saveToStorage();
      }
      
      // Notify local subscribers
      this.notifySubscribers(normalizedPath, newValue, 'update');
      
      logger.debug(`Updated value at path ${normalizedPath}`);
      
      return true;
    } catch (error) {
      logger.error(`Failed to update value at ${normalizedPath}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Increment a numeric value in the shared state
   * 
   * @param {string|Array} path - Path to the value
   * @param {number} incrementBy - Amount to increment by (default: 1)
   * @param {Object} metadata - Optional metadata
   * @returns {number} New value
   */
  async increment(path, incrementBy = 1, metadata = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    const normalizedPath = this.normalizePath(path);
    
    try {
      // Get the current value
      const currentValue = this.get(normalizedPath) || 0;
      
      // Ensure it's a number
      if (typeof currentValue !== 'number') {
        throw new Error(`Cannot increment non-numeric value at ${normalizedPath}`);
      }
      
      // Calculate the new value
      const newValue = currentValue + incrementBy;
      
      // Apply locally
      this.applyLocalUpdate(normalizedPath, newValue, 'increment', metadata);
      
      // Broadcast update
      await this.broadcastUpdate(normalizedPath, newValue, 'increment', metadata);
      
      // Save to storage if enabled
      if (this.config.persistToStorage && this.config.storageAdapter) {
        await this.saveToStorage();
      }
      
      // Notify local subscribers
      this.notifySubscribers(normalizedPath, newValue, 'increment');
      
      logger.debug(`Incremented value at path ${normalizedPath} by ${incrementBy}`);
      
      return newValue;
    } catch (error) {
      logger.error(`Failed to increment value at ${normalizedPath}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Append to an array in the shared state
   * 
   * @param {string|Array} path - Path to the array
   * @param {any} item - Item to append
   * @param {Object} metadata - Optional metadata
   * @returns {number} New array length
   */
  async append(path, item, metadata = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    const normalizedPath = this.normalizePath(path);
    
    try {
      // Get the current array
      let currentArray = this.get(normalizedPath);
      
      // If it doesn't exist or isn't an array, create it
      if (!Array.isArray(currentArray)) {
        currentArray = [];
      }
      
      // Create a new array to avoid mutation
      const newArray = [...currentArray, item];
      
      // Apply locally
      this.applyLocalUpdate(normalizedPath, newArray, 'append', metadata);
      
      // Broadcast update
      await this.broadcastUpdate(normalizedPath, newArray, 'append', {
        ...metadata,
        appended: item
      });
      
      // Save to storage if enabled
      if (this.config.persistToStorage && this.config.storageAdapter) {
        await this.saveToStorage();
      }
      
      // Notify local subscribers
      this.notifySubscribers(normalizedPath, newArray, 'append');
      
      logger.debug(`Appended item to array at path ${normalizedPath}`);
      
      return newArray.length;
    } catch (error) {
      logger.error(`Failed to append to array at ${normalizedPath}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get all keys at a specific path
   * 
   * @param {string|Array} path - Path to get keys from
   * @returns {Array} Array of keys or empty array if path doesn't exist
   */
  getKeys(path) {
    const normalizedPath = this.normalizePath(path);
    const obj = this.get(normalizedPath);
    
    if (obj === undefined || obj === null || typeof obj !== 'object') {
      return [];
    }
    
    return Object.keys(obj);
  }
  
  /**
   * Subscribe to changes at a specific path
   * 
   * @param {string|Array} path - Path to subscribe to
   * @param {Function} callback - Callback function
   * @returns {Object} Subscription handle
   */
  subscribe(path, callback) {
    const normalizedPath = this.normalizePath(path);
    const pathKey = normalizedPath.join('.');
    
    if (!this.subscribers.has(pathKey)) {
      this.subscribers.set(pathKey, new Set());
    }
    
    const subscribers = this.subscribers.get(pathKey);
    subscribers.add(callback);
    
    logger.debug(`Added subscriber to path ${pathKey}`);
    
    // Return a handle to unsubscribe
    return {
      path: normalizedPath,
      unsubscribe: () => {
        if (this.subscribers.has(pathKey)) {
          const subs = this.subscribers.get(pathKey);
          subs.delete(callback);
          
          if (subs.size === 0) {
            this.subscribers.delete(pathKey);
          }
          
          logger.debug(`Removed subscriber from path ${pathKey}`);
        }
      }
    };
  }
  
  /**
   * Notify subscribers of a change
   * 
   * @param {Array} path - Path that changed
   * @param {any} value - New value
   * @param {string} operation - Operation type
   */
  notifySubscribers(path, value, operation) {
    // Build an array of all parent paths to notify
    const pathsToNotify = [];
    
    // Add the exact path
    pathsToNotify.push([...path]);
    
    // Add all parent paths
    for (let i = path.length - 1; i >= 0; i--) {
      pathsToNotify.push(path.slice(0, i));
    }
    
    // Notify subscribers for each path
    for (const p of pathsToNotify) {
      const pathKey = p.join('.');
      
      if (this.subscribers.has(pathKey)) {
        const subscribers = this.subscribers.get(pathKey);
        
        for (const callback of subscribers) {
          try {
            callback({
              path: p,
              fullPath: path,
              value,
              operation,
              timestamp: Date.now()
            });
          } catch (error) {
            logger.error(`Error in subscriber callback: ${error.message}`);
          }
        }
      }
    }
  }
  
  /**
   * Apply a local update to the state
   * 
   * @param {Array} path - Path to update
   * @param {any} value - New value
   * @param {string} operation - Operation type
   * @param {Object} metadata - Update metadata
   */
  applyLocalUpdate(path, value, operation, metadata = {}) {
    if (path.length === 0) {
      // Updating the entire state
      if (operation === 'set' || operation === 'update') {
        this.state = value;
      } else {
        throw new Error('Cannot delete entire state');
      }
      
      return;
    }
    
    // Record in change log if tracking enabled
    if (this.config.changeTracking) {
      this.recordChange({
        path,
        value,
        operation,
        timestamp: Date.now(),
        sourceNodeId: this.nodeId,
        metadata
      });
    }
    
    // Handle operations on nested paths
    let current = this.state;
    
    // Create parent objects if they don't exist
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      
      if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') {
        // Create missing parent object
        current[key] = {};
      }
      
      current = current[key];
    }
    
    const lastKey = path[path.length - 1];
    
    // Apply the operation
    switch (operation) {
      case 'set':
      case 'update':
      case 'increment':
      case 'append':
        current[lastKey] = value;
        break;
      
      case 'delete':
        delete current[lastKey];
        break;
      
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  /**
   * Apply a remote update to the state
   * 
   * @param {Array} path - Path to update
   * @param {any} value - New value
   * @param {string} operation - Operation type
   * @param {Object} metadata - Update metadata
   */
  applyRemoteUpdate(path, value, operation, metadata = {}) {
    // For remote updates, we use the same implementation as local updates
    this.applyLocalUpdate(path, value, operation, metadata);
  }
  
  /**
   * Broadcast a state update to other nodes
   * 
   * @param {Array} path - Path that was updated
   * @param {any} value - New value
   * @param {string} operation - Operation type
   * @param {Object} metadata - Update metadata
   */
  async broadcastUpdate(path, value, operation, metadata = {}) {
    try {
      await this.updateChannel.broadcast({
        type: 'state-update',
        path,
        value,
        operation,
        timestamp: Date.now(),
        sourceNodeId: this.nodeId,
        metadata
      });
    } catch (error) {
      logger.error(`Failed to broadcast state update: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Record a change in the change log
   * 
   * @param {Object} change - Change to record
   */
  recordChange(change) {
    this.changeLog.push(change);
    
    // Trim change log if it's getting too long
    if (this.changeLog.length > this.config.changeHistory) {
      this.changeLog = this.changeLog.slice(-this.config.changeHistory);
    }
  }
  
  /**
   * Get the change history for a specific path
   * 
   * @param {string|Array} path - Path to get history for
   * @param {number} limit - Maximum number of changes to return
   * @returns {Array} Array of changes
   */
  getChangeHistory(path, limit = 10) {
    const normalizedPath = this.normalizePath(path);
    const pathKey = normalizedPath.join('.');
    
    // Filter changes that match the path
    const matchingChanges = this.changeLog
      .filter(change => change.path.join('.') === pathKey)
      .slice(-limit)
      .reverse(); // Most recent first
    
    return matchingChanges;
  }
  
  /**
   * Normalize a path to an array
   * 
   * @param {string|Array} path - Path to normalize
   * @returns {Array} Normalized path array
   */
  normalizePath(path) {
    if (Array.isArray(path)) {
      return path;
    }
    
    if (typeof path === 'string') {
      // Handle empty path
      if (path === '' || path === '.') {
        return [];
      }
      
      // Split by dots, but handle escaping
      return path.split('.')
        .map(segment => segment.replace(/\\./g, '.'));
    }
    
    // For any other type, convert to string and normalize
    return this.normalizePath(String(path));
  }
  
  /**
   * Acquire a lock on a specific path
   * 
   * @param {string|Array} path - Path to lock
   * @param {string} lockerId - ID of the locker
   * @param {number} timeout - Lock timeout in ms
   * @returns {boolean} True if lock acquired
   */
  async acquireLock(path, lockerId, timeout = null) {
    const normalizedPath = this.normalizePath(path);
    const lockPath = ['_locks', ...normalizedPath];
    
    // Check if already locked
    const currentLock = this.get(lockPath);
    
    if (currentLock && currentLock.expiresAt > Date.now()) {
      // Already locked by someone else
      if (currentLock.lockerId !== lockerId) {
        return false;
      }
      
      // Already locked by us, extend the lock
      const lockTimeout = timeout || this.config.lockTimeout;
      
      await this.set(lockPath, {
        lockerId,
        acquiredAt: currentLock.acquiredAt,
        expiresAt: Date.now() + lockTimeout,
        renewedAt: Date.now()
      });
      
      return true;
    }
    
    // No active lock, create one
    const lockTimeout = timeout || this.config.lockTimeout;
    
    await this.set(lockPath, {
      lockerId,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + lockTimeout,
      renewedAt: Date.now()
    });
    
    // Set up automatic lock expiration
    this.locks.set(normalizedPath.join('.'), setTimeout(() => {
      this.releaseLock(normalizedPath, lockerId).catch(error => {
        logger.error(`Error releasing expired lock: ${error.message}`);
      });
    }, lockTimeout));
    
    return true;
  }
  
  /**
   * Release a lock on a specific path
   * 
   * @param {string|Array} path - Path to unlock
   * @param {string} lockerId - ID of the locker
   * @returns {boolean} True if lock released
   */
  async releaseLock(path, lockerId) {
    const normalizedPath = this.normalizePath(path);
    const lockPath = ['_locks', ...normalizedPath];
    
    // Check current lock
    const currentLock = this.get(lockPath);
    
    if (!currentLock) {
      return true; // Already unlocked
    }
    
    // Only the locker can release the lock
    if (currentLock.lockerId !== lockerId) {
      return false;
    }
    
    // Clear the timeout
    const lockKey = normalizedPath.join('.');
    if (this.locks.has(lockKey)) {
      clearTimeout(this.locks.get(lockKey));
      this.locks.delete(lockKey);
    }
    
    // Delete the lock
    await this.delete(lockPath);
    
    return true;
  }
  
  /**
   * Check if a path is locked
   * 
   * @param {string|Array} path - Path to check
   * @returns {Object|null} Lock information or null if not locked
   */
  isLocked(path) {
    const normalizedPath = this.normalizePath(path);
    const lockPath = ['_locks', ...normalizedPath];
    
    const lock = this.get(lockPath);
    
    if (!lock) {
      return null;
    }
    
    // Check if lock has expired
    if (lock.expiresAt <= Date.now()) {
      return null;
    }
    
    return lock;
  }
  
  /**
   * Clean up expired locks
   */
  async cleanupExpiredLocks() {
    const locks = this.get(['_locks']) || {};
    const now = Date.now();
    const expiredLocks = [];
    
    // Helper function to recursively find expired locks
    const findExpiredLocks = (obj, path = []) => {
      if (!obj || typeof obj !== 'object') {
        return;
      }
      
      if (obj.expiresAt && obj.expiresAt <= now) {
        expiredLocks.push([...path]);
        return;
      }
      
      for (const [key, value] of Object.entries(obj)) {
        findExpiredLocks(value, [...path, key]);
      }
    };
    
    // Find all expired locks
    findExpiredLocks(locks);
    
    // Delete expired locks
    for (const lockPath of expiredLocks) {
      await this.delete(['_locks', ...lockPath]);
      
      logger.debug(`Cleaned up expired lock at ${lockPath.join('.')}`);
    }
    
    return expiredLocks.length;
  }
  
  /**
   * Get the entire state
   * 
   * @returns {Object} Current state
   */
  getState() {
    return this.state;
  }
  
  /**
   * Replace the entire state
   * 
   * @param {Object} newState - New state
   * @param {Object} metadata - Optional metadata
   */
  async setState(newState, metadata = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      // Apply locally
      this.applyLocalUpdate([], newState, 'set', metadata);
      
      // Broadcast update
      await this.broadcastUpdate([], newState, 'set', metadata);
      
      // Save to storage if enabled
      if (this.config.persistToStorage && this.config.storageAdapter) {
        await this.saveToStorage();
      }
      
      // Notify subscribers
      this.notifySubscribers([], newState, 'set');
      
      logger.info('Replaced entire state');
      
      return true;
    } catch (error) {
      logger.error(`Failed to replace state: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Merge an object into the state at a specific path
   * 
   * @param {string|Array} path - Path to merge at
   * @param {Object} obj - Object to merge
   * @param {Object} metadata - Optional metadata
   * @returns {boolean} Success flag
   */
  async merge(path, obj, metadata = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    const normalizedPath = this.normalizePath(path);
    
    try {
      // Get current value
      let current = this.get(normalizedPath);
      
      // If it doesn't exist or isn't an object, create it
      if (current === undefined || current === null || typeof current !== 'object' || Array.isArray(current)) {
        current = {};
      }
      
      // Perform the merge
      const merged = { ...current, ...obj };
      
      // Apply locally
      this.applyLocalUpdate(normalizedPath, merged, 'merge', metadata);
      
      // Broadcast update
      await this.broadcastUpdate(normalizedPath, merged, 'merge', {
        ...metadata,
        merged: obj
      });
      
      // Save to storage if enabled
      if (this.config.persistToStorage && this.config.storageAdapter) {
        await this.saveToStorage();
      }
      
      // Notify local subscribers
      this.notifySubscribers(normalizedPath, merged, 'merge');
      
      logger.debug(`Merged object at path ${normalizedPath}`);
      
      return true;
    } catch (error) {
      logger.error(`Failed to merge at ${normalizedPath}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get metrics about the shared state
   * 
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      nodeId: this.nodeId,
      initialized: this.isInitialized,
      stateSize: JSON.stringify(this.state).length,
      subscriberCount: Array.from(this.subscribers.values())
        .reduce((total, set) => total + set.size, 0),
      changeLogSize: this.changeLog.length,
      lockCount: this.locks.size,
      timestamp: Date.now()
    };
  }
  
  /**
   * Disconnect and clean up
   */
  async shutdown() {
    try {
      logger.info('Shutting down Shared State');
      
      // Release all locks
      for (const [lockKey, timeout] of this.locks.entries()) {
        clearTimeout(timeout);
      }
      this.locks.clear();
      
      // Save state if enabled
      if (this.config.persistToStorage && this.config.storageAdapter) {
        await this.saveToStorage();
      }
      
      // Close channels
      if (this.updateChannel) {
        await this.updateChannel.subscribe(this.nodeId).unsubscribe();
      }
      
      if (this.syncChannel) {
        await this.syncChannel.subscribe(this.nodeId).unsubscribe();
      }
      
      if (this.queryChannel) {
        await this.queryChannel.close();
      }
      
      // Disconnect from message queue
      await this.messageQueue.disconnect();
      
      logger.info('Shared State shut down');
      
      return true;
    } catch (error) {
      logger.error(`Error shutting down Shared State: ${error.message}`);
      throw error;
    }
  }
}

module.exports = SharedState;
