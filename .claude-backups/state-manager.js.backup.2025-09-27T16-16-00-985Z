/**
 * State Manager for the Agentic Software Development Swarm
 * 
 * This module manages workflow state persistence, snapshots, and recovery.
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');

class StateManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      persistenceEnabled: config.persistenceEnabled !== false,
      persistenceInterval: config.persistenceInterval || 60000, // 1 minute
      snapshotInterval: config.snapshotInterval || 600000, // 10 minutes
      storageType: config.storageType || 'memory', // 'memory', 'file', 'database'
      storagePath: config.storagePath || './data/state',
      maxSnapshots: config.maxSnapshots || 10
    };
    
    // Initialize state storage
    this.workflowStates = new Map();
    this.snapshotTimestamps = new Map();
    this.lastPersistenceTime = null;
    this.lastSnapshotTime = null;
    
    // Set up persistence if enabled
    if (this.config.persistenceEnabled) {
      this.setupPersistence();
    }
    
    logger.info('State Manager initialized');
    logger.debug(`State Manager configuration: ${JSON.stringify(this.config)}`);
  }

  /**
   * Set up automatic state persistence and snapshots
   */
  setupPersistence() {
    // Schedule periodic state persistence
    this.persistenceTimer = setInterval(() => {
      this.persistAllStates().catch(error => {
        logger.error(`Error persisting states: ${error.message}`);
      });
    }, this.config.persistenceInterval);

    // Schedule periodic snapshots
    this.snapshotTimer = setInterval(() => {
      this.createSnapshots().catch(error => {
        logger.error(`Error creating snapshots: ${error.message}`);
      });
    }, this.config.snapshotInterval);

    // Ensure storage directory exists for file storage
    if (this.config.storageType === 'file') {
      this.ensureStorageDirectories().catch(error => {
        logger.error(`Error creating storage directories: ${error.message}`);
      });
    }
    
    // Load existing state if available
    this.loadPersistedStates().catch(error => {
      logger.error(`Error loading persisted states: ${error.message}`);
    });

    logger.info('State persistence enabled');
  }

  /**
   * Ensure storage directories exist
   */
  async ensureStorageDirectories() {
    if (this.config.storageType !== 'file') return;
    
    try {
      const baseDir = this.config.storagePath;
      const stateDir = path.join(baseDir, 'current');
      const snapshotDir = path.join(baseDir, 'snapshots');

      await fs.mkdir(baseDir, { recursive: true });
      await fs.mkdir(stateDir, { recursive: true });
      await fs.mkdir(snapshotDir, { recursive: true });
      
      logger.debug('Storage directories created');
    } catch (error) {
      logger.error(`Error creating storage directories: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initialize a new workflow's state
   * 
   * @param {string} workflowId - ID of the workflow
   * @param {Object} initialState - Initial state object
   */
  initializeWorkflowState(workflowId, initialState) {
    // Don't overwrite existing state
    if (this.workflowStates.has(workflowId)) {
      throw new Error(`State for workflow ${workflowId} already exists`);
    }
    
    // Add metadata to state
    const stateWithMetadata = {
      ...initialState,
      _metadata: {
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        version: 1
      }
    };
    
    // Save the state
    this.workflowStates.set(workflowId, stateWithMetadata);
    this.snapshotTimestamps.set(workflowId, []);
    
    logger.info(`Initialized state for workflow ${workflowId}`);
    this.emit('state:initialized', { workflowId });
    
    // Persist immediately if enabled
    if (this.config.persistenceEnabled) {
      this.persistWorkflowState(workflowId).catch(error => {
        logger.error(`Error persisting state for workflow ${workflowId}: ${error.message}`);
      });
    }
    
    return stateWithMetadata;
  }

  /**
   * Get the current state of a workflow
   * 
   * @param {string} workflowId - ID of the workflow
   * @returns {Object|null} Current state or null if not found
   */
  getWorkflowState(workflowId) {
    return this.workflowStates.get(workflowId) || null;
  }

  /**
   * Update a workflow's state
   * 
   * @param {string} workflowId - ID of the workflow
   * @param {Object} stateUpdates - State updates to apply
   * @returns {Object} Updated state
   */
  updateWorkflowState(workflowId, stateUpdates) {
    // Ensure workflow state exists
    const currentState = this.workflowStates.get(workflowId);
    
    if (!currentState) {
      throw new Error(`No state found for workflow ${workflowId}`);
    }
    
    // Create a deep copy of the current state to avoid accidental mutations
    const currentStateCopy = JSON.parse(JSON.stringify(currentState));
    
    // Handle special case of metadata updates
    if (stateUpdates._metadata) {
      currentStateCopy._metadata = {
        ...currentStateCopy._metadata,
        ...stateUpdates._metadata
      };
      delete stateUpdates._metadata;
    }
    
    // Apply updates, excluding metadata which was already handled
    const updatedState = {
      ...currentStateCopy,
      ...stateUpdates,
      _metadata: {
        ...currentStateCopy._metadata,
        lastUpdated: Date.now(),
        version: currentStateCopy._metadata.version + 1
      }
    };
    
    // Save the updated state
    this.workflowStates.set(workflowId, updatedState);
    
    logger.debug(`Updated state for workflow ${workflowId} (version ${updatedState._metadata.version})`);
    this.emit('state:updated', { 
      workflowId, 
      version: updatedState._metadata.version
    });
    
    return updatedState;
  }

  /**
   * Create a state snapshot for a workflow
   * 
   * @param {string} workflowId - ID of the workflow
   * @returns {Object} The snapshot that was created
   */
  async createWorkflowSnapshot(workflowId) {
    const state = this.workflowStates.get(workflowId);
    
    if (!state) {
      throw new Error(`No state found for workflow ${workflowId}`);
    }
    
    // Create snapshot with timestamp
    const timestamp = Date.now();
    const snapshot = {
      ...JSON.parse(JSON.stringify(state)), // Deep copy
      _snapshotMetadata: {
        timestamp,
        originalVersion: state._metadata.version
      }
    };
    
    // If using file storage, save snapshot to file
    if (this.config.storageType === 'file') {
      await this.saveSnapshotToFile(workflowId, snapshot);
    }
    
    // Keep track of snapshot timestamps
    const timestamps = this.snapshotTimestamps.get(workflowId) || [];
    timestamps.push(timestamp);
    this.snapshotTimestamps.set(workflowId, timestamps);
    
    // Clean up old snapshots if we have too many
    if (timestamps.length > this.config.maxSnapshots) {
      await this.cleanupOldSnapshots(workflowId);
    }
    
    logger.info(`Created snapshot for workflow ${workflowId} at ${new Date(timestamp).toISOString()}`);
    this.emit('state:snapshot-created', { 
      workflowId, 
      timestamp,
      version: state._metadata.version
    });
    
    return snapshot;
  }

  /**
   * Restore a workflow state from a snapshot
   * 
   * @param {string} workflowId - ID of the workflow
   * @param {number} timestamp - Timestamp of the snapshot to restore
   * @returns {Object} The restored state
   */
  async restoreWorkflowSnapshot(workflowId, timestamp) {
    let snapshot;
    
    // Get snapshot from storage
    if (this.config.storageType === 'file') {
      snapshot = await this.loadSnapshotFromFile(workflowId, timestamp);
    } else {
      throw new Error('Snapshot restoration is only supported with file storage');
    }
    
    if (!snapshot) {
      throw new Error(`No snapshot found for workflow ${workflowId} at timestamp ${timestamp}`);
    }
    
    // Remove snapshot metadata and update the regular metadata
    const { _snapshotMetadata, ...snapshotData } = snapshot;
    
    const restoredState = {
      ...snapshotData,
      _metadata: {
        ...snapshotData._metadata,
        lastUpdated: Date.now(),
        restoredFrom: timestamp,
        version: snapshotData._metadata.version + 1
      }
    };
    
    // Save the restored state
    this.workflowStates.set(workflowId, restoredState);
    
    logger.info(`Restored workflow ${workflowId} state from snapshot at ${new Date(timestamp).toISOString()}`);
    this.emit('state:restored', { 
      workflowId, 
      fromTimestamp: timestamp,
      toVersion: restoredState._metadata.version
    });
    
    return restoredState;
  }

  /**
   * Persist a specific workflow's state to storage
   * 
   * @param {string} workflowId - ID of the workflow
   */
  async persistWorkflowState(workflowId) {
    if (!this.config.persistenceEnabled) return;
    
    const state = this.workflowStates.get(workflowId);
    
    if (!state) {
      throw new Error(`No state found for workflow ${workflowId}`);
    }
    
    try {
      if (this.config.storageType === 'file') {
        await this.saveStateToFile(workflowId, state);
      } else if (this.config.storageType === 'database') {
        await this.saveStateToDatabase(workflowId, state);
      }
      
      logger.debug(`Persisted state for workflow ${workflowId}`);
      this.emit('state:persisted', { workflowId });
    } catch (error) {
      logger.error(`Error persisting state for workflow ${workflowId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Persist all workflow states to storage
   */
  async persistAllStates() {
    if (!this.config.persistenceEnabled) return;
    
    const workflowIds = Array.from(this.workflowStates.keys());
    
    if (workflowIds.length === 0) {
      return;
    }
    
    logger.debug(`Persisting all states (${workflowIds.length} workflows)`);
    
    try {
      await Promise.all(
        workflowIds.map(workflowId => this.persistWorkflowState(workflowId))
      );
      
      this.lastPersistenceTime = Date.now();
      logger.info('All states persisted successfully');
      this.emit('state:all-persisted', { count: workflowIds.length });
    } catch (error) {
      logger.error(`Error persisting all states: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create snapshots for all workflows
   */
  async createSnapshots() {
    if (!this.config.persistenceEnabled) return;
    
    const workflowIds = Array.from(this.workflowStates.keys());
    
    if (workflowIds.length === 0) {
      return;
    }
    
    logger.debug(`Creating snapshots for all workflows (${workflowIds.length} workflows)`);
    
    try {
      await Promise.all(
        workflowIds.map(workflowId => this.createWorkflowSnapshot(workflowId))
      );
      
      this.lastSnapshotTime = Date.now();
      logger.info('All snapshots created successfully');
      this.emit('state:all-snapshots-created', { count: workflowIds.length });
    } catch (error) {
      logger.error(`Error creating snapshots: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove a workflow's state from the manager
   * 
   * @param {string} workflowId - ID of the workflow
   */
  removeWorkflowState(workflowId) {
    if (!this.workflowStates.has(workflowId)) {
      return false;
    }
    
    this.workflowStates.delete(workflowId);
    
    logger.info(`Removed state for workflow ${workflowId}`);
    this.emit('state:removed', { workflowId });
    
    // Remove from storage if persistence is enabled
    if (this.config.persistenceEnabled) {
      this.removeStateFromStorage(workflowId).catch(error => {
        logger.error(`Error removing persisted state for workflow ${workflowId}: ${error.message}`);
      });
    }
    
    return true;
  }

  /**
   * Load persisted states from storage
   */
  async loadPersistedStates() {
    if (!this.config.persistenceEnabled) return;
    
    try {
      if (this.config.storageType === 'file') {
        await this.loadStatesFromFile();
      } else if (this.config.storageType === 'database') {
        await this.loadStatesFromDatabase();
      }
      
      logger.info(`Loaded ${this.workflowStates.size} persisted workflow states`);
      this.emit('state:loaded', { count: this.workflowStates.size });
    } catch (error) {
      logger.error(`Error loading persisted states: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save a state to file storage
   * 
   * @param {string} workflowId - ID of the workflow
   * @param {Object} state - State to save
   */
  async saveStateToFile(workflowId, state) {
    try {
      await this.ensureStorageDirectories();
      
      const stateDir = path.join(this.config.storagePath, 'current');
      const filePath = path.join(stateDir, `${workflowId}.json`);
      
      await fs.writeFile(
        filePath,
        JSON.stringify(state, null, 2),
        'utf8'
      );
      
      logger.debug(`Saved state to file: ${filePath}`);
    } catch (error) {
      logger.error(`Error saving state to file for workflow ${workflowId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save a snapshot to file storage
   * 
   * @param {string} workflowId - ID of the workflow
   * @param {Object} snapshot - Snapshot to save
   */
  async saveSnapshotToFile(workflowId, snapshot) {
    try {
      await this.ensureStorageDirectories();
      
      const timestamp = snapshot._snapshotMetadata.timestamp;
      const snapshotDir = path.join(this.config.storagePath, 'snapshots', workflowId);
      const filePath = path.join(snapshotDir, `${timestamp}.json`);
      
      await fs.mkdir(snapshotDir, { recursive: true });
      
      await fs.writeFile(
        filePath,
        JSON.stringify(snapshot, null, 2),
        'utf8'
      );
      
      logger.debug(`Saved snapshot to file: ${filePath}`);
    } catch (error) {
      logger.error(`Error saving snapshot to file for workflow ${workflowId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load all states from file storage
   */
  async loadStatesFromFile() {
    try {
      await this.ensureStorageDirectories();
      
      const stateDir = path.join(this.config.storagePath, 'current');
      const files = await fs.readdir(stateDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const workflowId = file.replace('.json', '');
        const filePath = path.join(stateDir, file);
        
        try {
          const data = await fs.readFile(filePath, 'utf8');
          const state = JSON.parse(data);
          
          this.workflowStates.set(workflowId, state);
          
          // Also load snapshot timestamps
          await this.loadSnapshotTimestamps(workflowId);
          
          logger.debug(`Loaded state from file: ${filePath}`);
        } catch (error) {
          logger.error(`Error loading state from file ${filePath}: ${error.message}`);
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Directory doesn't exist yet, which is fine for a fresh start
        logger.debug('No persisted states found');
        return;
      }
      
      logger.error(`Error loading states from files: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load snapshot timestamps for a workflow
   * 
   * @param {string} workflowId - ID of the workflow
   */
  async loadSnapshotTimestamps(workflowId) {
    try {
      const snapshotDir = path.join(this.config.storagePath, 'snapshots', workflowId);
      
      try {
        const files = await fs.readdir(snapshotDir);
        
        const timestamps = files
          .filter(file => file.endsWith('.json'))
          .map(file => parseInt(file.replace('.json', ''), 10))
          .filter(timestamp => !isNaN(timestamp))
          .sort((a, b) => b - a); // Sort descending (newest first)
        
        this.snapshotTimestamps.set(workflowId, timestamps);
        
        logger.debug(`Loaded ${timestamps.length} snapshot timestamps for workflow ${workflowId}`);
      } catch (error) {
        if (error.code === 'ENOENT') {
          // No snapshots yet for this workflow
          this.snapshotTimestamps.set(workflowId, []);
          return;
        }
        
        throw error;
      }
    } catch (error) {
      logger.error(`Error loading snapshot timestamps for workflow ${workflowId}: ${error.message}`);
      this.snapshotTimestamps.set(workflowId, []);
    }
  }

  /**
   * Load a specific snapshot from file storage
   * 
   * @param {string} workflowId - ID of the workflow
   * @param {number} timestamp - Timestamp of the snapshot
   * @returns {Object} The loaded snapshot
   */
  async loadSnapshotFromFile(workflowId, timestamp) {
    try {
      const snapshotDir = path.join(this.config.storagePath, 'snapshots', workflowId);
      const filePath = path.join(snapshotDir, `${timestamp}.json`);
      
      const data = await fs.readFile(filePath, 'utf8');
      const snapshot = JSON.parse(data);
      
      logger.debug(`Loaded snapshot from file: ${filePath}`);
      
      return snapshot;
    } catch (error) {
      logger.error(`Error loading snapshot for workflow ${workflowId} at timestamp ${timestamp}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clean up old snapshots beyond the maximum allowed
   * 
   * @param {string} workflowId - ID of the workflow
   */
  async cleanupOldSnapshots(workflowId) {
    const timestamps = this.snapshotTimestamps.get(workflowId) || [];
    
    if (timestamps.length <= this.config.maxSnapshots) {
      return;
    }
    
    // Sort timestamps descending (newest first)
    timestamps.sort((a, b) => b - a);
    
    // Keep only the most recent ones
    const timestampsToKeep = timestamps.slice(0, this.config.maxSnapshots);
    const timestampsToRemove = timestamps.slice(this.config.maxSnapshots);
    
    // Update the stored list
    this.snapshotTimestamps.set(workflowId, timestampsToKeep);
    
    // Remove the old snapshots from storage
    if (this.config.storageType === 'file') {
      await Promise.all(
        timestampsToRemove.map(timestamp => this.removeSnapshotFile(workflowId, timestamp))
      );
    }
    
    logger.debug(`Cleaned up ${timestampsToRemove.length} old snapshots for workflow ${workflowId}`);
  }

  /**
   * Remove a snapshot file from storage
   * 
   * @param {string} workflowId - ID of the workflow
   * @param {number} timestamp - Timestamp of the snapshot
   */
  async removeSnapshotFile(workflowId, timestamp) {
    try {
      const snapshotDir = path.join(this.config.storagePath, 'snapshots', workflowId);
      const filePath = path.join(snapshotDir, `${timestamp}.json`);
      
      await fs.unlink(filePath);
      
      logger.debug(`Removed snapshot file: ${filePath}`);
    } catch (error) {
      logger.error(`Error removing snapshot file for workflow ${workflowId} at timestamp ${timestamp}: ${error.message}`);
    }
  }

  /**
   * Remove persisted state from storage
   * 
   * @param {string} workflowId - ID of the workflow
   */
  async removeStateFromStorage(workflowId) {
    if (!this.config.persistenceEnabled) return;
    
    try {
      if (this.config.storageType === 'file') {
        await this.removeStateFile(workflowId);
        await this.removeAllSnapshotFiles(workflowId);
      } else if (this.config.storageType === 'database') {
        await this.removeStateFromDatabase(workflowId);
      }
      
      logger.debug(`Removed persisted state for workflow ${workflowId}`);
    } catch (error) {
      logger.error(`Error removing persisted state for workflow ${workflowId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove a state file from storage
   * 
   * @param {string} workflowId - ID of the workflow
   */
  async removeStateFile(workflowId) {
    try {
      const stateDir = path.join(this.config.storagePath, 'current');
      const filePath = path.join(stateDir, `${workflowId}.json`);
      
      await fs.unlink(filePath);
      
      logger.debug(`Removed state file: ${filePath}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, which is fine
        return;
      }
      
      logger.error(`Error removing state file for workflow ${workflowId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove all snapshot files for a workflow
   * 
   * @param {string} workflowId - ID of the workflow
   */
  async removeAllSnapshotFiles(workflowId) {
    try {
      const snapshotDir = path.join(this.config.storagePath, 'snapshots', workflowId);
      
      try {
        const files = await fs.readdir(snapshotDir);
        
        await Promise.all(
          files.map(file => fs.unlink(path.join(snapshotDir, file)))
        );
        
        // Try to remove the directory as well
        await fs.rmdir(snapshotDir);
        
        logger.debug(`Removed all snapshot files for workflow ${workflowId}`);
      } catch (error) {
        if (error.code === 'ENOENT') {
          // Directory doesn't exist, which is fine
          return;
        }
        
        throw error;
      }
    } catch (error) {
      logger.error(`Error removing snapshot files for workflow ${workflowId}: ${error.message}`);
    }
  }

  /**
   * Database storage methods (placeholders - implementation would depend on the database)
   */
  
  async saveStateToDatabase(workflowId, state) {
    // Placeholder for database implementation
    logger.debug(`Database storage not implemented`);
  }

  async loadStatesFromDatabase() {
    // Placeholder for database implementation
    logger.debug(`Database storage not implemented`);
  }

  async removeStateFromDatabase(workflowId) {
    // Placeholder for database implementation
    logger.debug(`Database storage not implemented`);
  }

  /**
   * Clean up resources when shutting down
   */
  async shutdown() {
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
    }
    
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
    }
    
    if (this.config.persistenceEnabled) {
      // Persist all states one last time
      try {
        await this.persistAllStates();
        logger.info('Final state persistence completed before shutdown');
      } catch (error) {
        logger.error(`Error during final state persistence: ${error.message}`);
      }
    }
    
    logger.info('State Manager shut down');
  }
}

module.exports = StateManager;
