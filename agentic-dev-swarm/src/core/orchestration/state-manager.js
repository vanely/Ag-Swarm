const logger = require('../../utils/logger');
const SharedState = require('../communication/shared-state');
const MessageQueue = require('../communication/message-queue');

/**
 * StateManager class responsible for managing the system state,
 * tracking task status, and ensuring state consistency across agents
 */
class StateManager {
  constructor() {
    this.sharedState = new SharedState();
    this.messageQueue = new MessageQueue();
    
    this.stateSchema = {
      system: {
        phase: { type: 'string', enum: ['initialization', 'planning', 'development', 'integration', 'deployment', 'completed'] },
        status: { type: 'string', enum: ['idle', 'active', 'paused', 'error'] },
        startTime: { type: 'number' },
        lastUpdated: { type: 'number' }
      },
      agents: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['initializing', 'active', 'busy', 'error', 'inactive'] },
          lastHeartbeat: { type: 'number' },
          currentTasks: { type: 'array' }
        }
      },
      tasks: {
        type: 'object',
        properties: {
          pending: { type: 'array' },
          inProgress: { type: 'array' },
          completed: { type: 'array' },
          failed: { type: 'array' }
        }
      },
      artifacts: {
        type: 'object',
        properties: {
          latest: { type: 'object' }
        }
      },
      issues: {
        type: 'array'
      }
    };
    
    // Transition rules for state changes
    this.transitionRules = {
      system: {
        phase: {
          'initialization': ['planning'],
          'planning': ['development'],
          'development': ['integration'],
          'integration': ['deployment'],
          'deployment': ['completed'],
          'completed': []
        }
      },
      agents: {
        status: {
          'initializing': ['active', 'error'],
          'active': ['busy', 'inactive', 'error'],
          'busy': ['active', 'error'],
          'error': ['active', 'inactive'],
          'inactive': ['initializing']
        }
      }
    };
  }

  /**
   * Initialize the state manager and set up initial system state
   */
  async initialize() {
    try {
      // Check for existing state
      const existingState = await this.sharedState.get('system');
      
      if (!existingState) {
        // Set up initial system state
        const initialState = {
          phase: 'initialization',
          status: 'idle',
          startTime: Date.now(),
          lastUpdated: Date.now()
        };
        
        await this.sharedState.set('system', initialState);
        
        // Set up initial tasks state
        await this.sharedState.set('tasks', {
          pending: [],
          inProgress: [],
          completed: [],
          failed: []
        });
        
        // Set up initial artifacts state
        await this.sharedState.set('artifacts', {
          latest: {}
        });
        
        // Set up initial issues state
        await this.sharedState.set('issues', []);
        
        logger.info('StateManager initialized with default state');
      } else {
        logger.info('StateManager initialized with existing state');
      }
      
      // Subscribe to state change events
      this.messageQueue.subscribe('system.state_change_requested', this.handleStateChangeRequest.bind(this));
      this.messageQueue.subscribe('agent.state_change_requested', this.handleAgentStateChangeRequest.bind(this));
      this.messageQueue.subscribe('task.state_change_requested', this.handleTaskStateChangeRequest.bind(this));
      
      // Set up heartbeat monitoring
      setInterval(this.monitorAgentHeartbeats.bind(this), 30000); // Check every 30 seconds
    } catch (error) {
      logger.error(`Error initializing StateManager: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the current system state or a specific state component
   * @param {String} component - Optional state component to retrieve
   * @returns {Object} The requested state
   */
  async getState(component = null) {
    try {
      if (component) {
        return await this.sharedState.get(component);
      } else {
        // Retrieve all state components
        const system = await this.sharedState.get('system');
        const agents = await this.sharedState.get('agents');
        const tasks = await this.sharedState.get('tasks');
        const artifacts = await this.sharedState.get('artifacts');
        const issues = await this.sharedState.get('issues');
        
        return {
          system,
          agents,
          tasks,
          artifacts,
          issues
        };
      }
    } catch (error) {
      logger.error(`Error getting state: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update a specific part of the system state
   * @param {String} component - The state component to update
   * @param {Object} update - The update to apply
   * @param {Boolean} validate - Whether to validate the update
   * @returns {Object} The updated state
   */
  async updateState(component, update, validate = true) {
    try {
      // Get current state for the component
      const currentState = await this.sharedState.get(component) || {};
      
      // Validate the update if required
      if (validate) {
        const validationResult = this.validateStateUpdate(component, currentState, update);
        
        if (!validationResult.valid) {
          throw new Error(`Invalid state update for ${component}: ${validationResult.reason}`);
        }
      }
      
      // Merge the update with the current state
      const updatedState = this.mergeState(currentState, update);
      
      // Update the lastUpdated timestamp for system state
      if (component === 'system') {
        updatedState.lastUpdated = Date.now();
      }
      
      // Store the updated state
      await this.sharedState.set(component, updatedState);
      
      // Publish state change event
      await this.messageQueue.publish(`state.${component}_updated`, {
        component,
        previousState: currentState,
        currentState: updatedState
      });
      
      logger.debug(`Updated ${component} state`);
      
      return updatedState;
    } catch (error) {
      logger.error(`Error updating state for ${component}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Merge current state with updates
   * @param {Object} currentState - Current state
   * @param {Object} update - Update to apply
   * @returns {Object} Merged state
   */
  mergeState(currentState, update) {
    // For arrays, replace the entire array
    if (Array.isArray(currentState) && Array.isArray(update)) {
      return [...update];
    }
    
    // For primitive values or non-objects, replace with update
    if (typeof currentState !== 'object' || currentState === null || 
        typeof update !== 'object' || update === null) {
      return update;
    }
    
    // For objects, merge recursively
    const result = { ...currentState };
    
    for (const [key, value] of Object.entries(update)) {
      if (typeof value === 'object' && value !== null && typeof result[key] === 'object' && result[key] !== null) {
        result[key] = this.mergeState(result[key], value);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  /**
   * Validate a state update against the schema and transition rules
   * @param {String} component - The state component being updated
   * @param {Object} currentState - Current state
   * @param {Object} update - Update to apply
   * @returns {Object} Validation result with valid flag and reason
   */
  validateStateUpdate(component, currentState, update) {
    // Skip validation for components without schema or rules
    if (!this.stateSchema[component]) {
      return { valid: true };
    }
    
    // Check for phase transitions
    if (component === 'system' && update.phase && currentState.phase !== update.phase) {
      const validTransitions = this.transitionRules.system.phase[currentState.phase] || [];
      
      if (!validTransitions.includes(update.phase)) {
        return {
          valid: false,
          reason: `Invalid phase transition from '${currentState.phase}' to '${update.phase}'`
        };
      }
    }
    
    // Check for agent status transitions
    if (component === 'agents' && update.status && currentState.status !== update.status) {
      const validTransitions = this.transitionRules.agents.status[currentState.status] || [];
      
      if (!validTransitions.includes(update.status)) {
        return {
          valid: false,
          reason: `Invalid agent status transition from '${currentState.status}' to '${update.status}'`
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Get the current system phase
   * @returns {String} Current system phase
   */
  async getCurrentPhase() {
    const system = await this.sharedState.get('system');
    return system ? system.phase : 'initialization';
  }

  /**
   * Transition the system to a new phase
   * @param {String} newPhase - The new phase to transition to
   * @returns {Boolean} Success status of the transition
   */
  async transitionToPhase(newPhase) {
    try {
      const currentPhase = await this.getCurrentPhase();
      
      // Validate the phase transition
      const validTransitions = this.transitionRules.system.phase[currentPhase] || [];
      
      if (!validTransitions.includes(newPhase)) {
        logger.error(`Invalid phase transition from '${currentPhase}' to '${newPhase}'`);
        return false;
      }
      
      // Update the system state with the new phase
      await this.updateState('system', { phase: newPhase });
      
      // Publish phase transition event
      await this.messageQueue.publish('system.phase_changed', {
        previousPhase: currentPhase,
        currentPhase: newPhase,
        timestamp: Date.now()
      });
      
      logger.info(`Transitioned from phase '${currentPhase}' to '${newPhase}'`);
      return true;
    } catch (error) {
      logger.error(`Error transitioning to phase ${newPhase}: ${error.message}`);
      return false;
    }
  }

  /**
   * Register an agent in the state system
   * @param {String} agentName - The name of the agent
   * @param {Object} agentInfo - Information about the agent
   */
  async registerAgent(agentName, agentInfo) {
    try {
      // Get current agents state
      const agents = await this.sharedState.get('agents') || {};
      
      // Add or update the agent
      agents[agentName] = {
        ...agentInfo,
        status: 'active',
        lastHeartbeat: Date.now(),
        currentTasks: []
      };
      
      // Save updated agents state
      await this.sharedState.set('agents', agents);
      
      // Publish agent registration event
      await this.messageQueue.publish('agent.registered', {
        agentName,
        agentInfo: agents[agentName]
      });
      
      logger.info(`Registered agent ${agentName} in state system`);
    } catch (error) {
      logger.error(`Error registering agent ${agentName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update an agent's status
   * @param {String} agentName - The name of the agent
   * @param {String} status - The new status
   */
  async updateAgentStatus(agentName, status) {
    try {
      // Get current agents state
      const agents = await this.sharedState.get('agents') || {};
      
      // Ensure agent exists
      if (!agents[agentName]) {
        throw new Error(`Agent ${agentName} is not registered`);
      }
      
      // Get current status
      const currentStatus = agents[agentName].status;
      
      // Validate the status transition
      const validTransitions = this.transitionRules.agents.status[currentStatus] || [];
      
      if (!validTransitions.includes(status)) {
        throw new Error(`Invalid agent status transition from '${currentStatus}' to '${status}'`);
      }
      
      // Update the agent's status
      agents[agentName].status = status;
      agents[agentName].lastHeartbeat = Date.now();
      
      // Save updated agents state
      await this.sharedState.set('agents', agents);
      
      // Publish agent status change event
      await this.messageQueue.publish('agent.status_changed', {
        agentName,
        previousStatus: currentStatus,
        currentStatus: status,
        timestamp: Date.now()
      });
      
      logger.info(`Updated agent ${agentName} status to '${status}'`);
    } catch (error) {
      logger.error(`Error updating agent ${agentName} status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle agent heartbeats and update state
   * @param {String} agentName - The name of the agent
   */
  async updateAgentHeartbeat(agentName) {
    try {
      // Get current agents state
      const agents = await this.sharedState.get('agents') || {};
      
      // Ensure agent exists
      if (!agents[agentName]) {
        throw new Error(`Agent ${agentName} is not registered`);
      }
      
      // Update the agent's heartbeat timestamp
      agents[agentName].lastHeartbeat = Date.now();
      
      // Save updated agents state
      await this.sharedState.set('agents', agents);
      
      logger.debug(`Updated heartbeat for agent ${agentName}`);
    } catch (error) {
      logger.error(`Error updating agent ${agentName} heartbeat: ${error.message}`);
    }
  }

  /**
   * Monitor agent heartbeats and detect inactive agents
   */
  async monitorAgentHeartbeats() {
    try {
      // Get current agents state
      const agents = await this.sharedState.get('agents') || {};
      
      // Check each agent's heartbeat
      const now = Date.now();
      const heartbeatTimeout = 60000; // 1 minute timeout
      
      for (const [agentName, agentInfo] of Object.entries(agents)) {
        // Skip inactive agents
        if (agentInfo.status === 'inactive') {
          continue;
        }
        
        // Check if heartbeat has timed out
        if (now - agentInfo.lastHeartbeat > heartbeatTimeout) {
          logger.warn(`Agent ${agentName} heartbeat timeout`);
          
          // Mark agent as error
          await this.updateAgentStatus(agentName, 'error');
          
          // Add to issues
          await this.addIssue({
            type: 'agent_timeout',
            agentName,
            message: `Agent ${agentName} heartbeat timeout`,
            timestamp: now,
            resolved: false
          });
          
          // Reassign tasks from the agent
          await this.reassignAgentTasks(agentName);
        }
      }
    } catch (error) {
      logger.error(`Error monitoring agent heartbeats: ${error.message}`);
    }
  }

  /**
   * Add a task to the system
   * @param {Object} task - The task to add
   * @returns {Object} The added task with ID
   */
  async addTask(task) {
    try {
      // Get current tasks state
      const tasks = await this.sharedState.get('tasks') || {
        pending: [],
        inProgress: [],
        completed: [],
        failed: []
      };
      
      // Generate task ID if not provided
      if (!task.id) {
        task.id = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
      
      // Add task metadata
      task.status = 'pending';
      task.createdAt = Date.now();
      task.updatedAt = Date.now();
      
      // Add to pending tasks
      tasks.pending.push(task);
      
      // Save updated tasks state
      await this.sharedState.set('tasks', tasks);
      
      // Publish task added event
      await this.messageQueue.publish('task.added', {
        task,
        timestamp: Date.now()
      });
      
      logger.info(`Added task ${task.id} to the system`);
      
      return task;
    } catch (error) {
      logger.error(`Error adding task: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update a task's status
   * @param {String} taskId - The ID of the task
   * @param {String} status - The new status
   * @param {Object} additionalData - Additional data to update
   * @returns {Object} The updated task
   */
  async updateTaskStatus(taskId, status, additionalData = {}) {
    try {
      // Get current tasks state
      const tasks = await this.sharedState.get('tasks') || {
        pending: [],
        inProgress: [],
        completed: [],
        failed: []
      };
      
      // Find the task in the appropriate list
      let task = null;
      let sourceList = null;
      
      for (const listName of ['pending', 'inProgress', 'completed', 'failed']) {
        const index = tasks[listName].findIndex(t => t.id === taskId);
        
        if (index >= 0) {
          task = tasks[listName][index];
          sourceList = listName;
          
          // Remove from source list
          tasks[listName].splice(index, 1);
          break;
        }
      }
      
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }
      
      // Update task status and data
      task.status = status;
      task.updatedAt = Date.now();
      
      // Add additional data
      for (const [key, value] of Object.entries(additionalData)) {
        task[key] = value;
      }
      
      // Add to appropriate target list
      let targetList = 'pending';
      
      switch (status) {
        case 'pending':
          targetList = 'pending';
          break;
        case 'in_progress':
          targetList = 'inProgress';
          break;
        case 'completed':
          targetList = 'completed';
          break;
        case 'failed':
          targetList = 'failed';
          break;
      }
      
      tasks[targetList].push(task);
      
      // Save updated tasks state
      await this.sharedState.set('tasks', tasks);
      
      // Publish task status change event
      await this.messageQueue.publish('task.status_changed', {
        taskId,
        previousStatus: task.previousStatus || sourceList,
        currentStatus: status,
        task,
        timestamp: Date.now()
      });
      
      logger.info(`Updated task ${taskId} status to '${status}'`);
      
      return task;
    } catch (error) {
      logger.error(`Error updating task ${taskId} status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reassign tasks from an agent
   * @param {String} agentName - The name of the agent
   */
  async reassignAgentTasks(agentName) {
    try {
      // Get current tasks state
      const tasks = await this.sharedState.get('tasks') || {
        pending: [],
        inProgress: [],
        completed: [],
        failed: []
      };
      
      // Find in-progress tasks assigned to the agent
      const agentTasks = tasks.inProgress.filter(task => task.assignedAgent === agentName);
      
      if (agentTasks.length === 0) {
        return;
      }
      
      logger.info(`Reassigning ${agentTasks.length} tasks from agent ${agentName}`);
      
      // Move tasks back to pending
      for (const task of agentTasks) {
        await this.updateTaskStatus(task.id, 'pending', {
          previousStatus: 'in_progress',
          previousAgent: agentName,
          assignedAgent: null,
          needsReassignment: true
        });
      }
      
      // Publish task reassignment event
      await this.messageQueue.publish('task.reassignment_needed', {
        agentName,
        taskCount: agentTasks.length,
        taskIds: agentTasks.map(task => task.id),
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error reassigning tasks from agent ${agentName}: ${error.message}`);
    }
  }

  /**
   * Add an issue to the system
   * @param {Object} issue - The issue to add
   * @returns {Object} The added issue with ID
   */
  async addIssue(issue) {
    try {
      // Get current issues
      const issues = await this.sharedState.get('issues') || [];
      
      // Generate issue ID if not provided
      if (!issue.id) {
        issue.id = `issue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
      
      // Add issue metadata
      issue.createdAt = issue.timestamp || Date.now();
      issue.updatedAt = issue.timestamp || Date.now();
      
      // Add to issues
      issues.push(issue);
      
      // Save updated issues
      await this.sharedState.set('issues', issues);
      
      // Publish issue added event
      await this.messageQueue.publish('issue.added', {
        issue,
        timestamp: Date.now()
      });
      
      logger.info(`Added issue ${issue.id} to the system`);
      
      return issue;
    } catch (error) {
      logger.error(`Error adding issue: ${error.message}`);
      throw error;
    }
  }

  /**
   * Resolve an issue
   * @param {String} issueId - The ID of the issue
   * @param {Object} resolution - Resolution information
   * @returns {Object} The resolved issue
   */
  async resolveIssue(issueId, resolution) {
    try {
      // Get current issues
      const issues = await this.sharedState.get('issues') || [];
      
      // Find the issue
      const issueIndex = issues.findIndex(issue => issue.id === issueId);
      
      if (issueIndex < 0) {
        throw new Error(`Issue ${issueId} not found`);
      }
      
      // Update the issue
      const issue = issues[issueIndex];
      
      issue.resolved = true;
      issue.resolution = resolution;
      issue.updatedAt = Date.now();
      issue.resolvedAt = Date.now();
      
      // Save updated issues
      await this.sharedState.set('issues', issues);
      
      // Publish issue resolved event
      await this.messageQueue.publish('issue.resolved', {
        issueId,
        resolution,
        issue,
        timestamp: Date.now()
      });
      
      logger.info(`Resolved issue ${issueId}`);
      
      return issue;
    } catch (error) {
      logger.error(`Error resolving issue ${issueId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Track an artifact in the system
   * @param {String} artifactType - The type of artifact
   * @param {String} artifactId - The ID of the artifact
   * @param {Object} metadata - Artifact metadata
   * @returns {Object} The tracked artifact
   */
  async trackArtifact(artifactType, artifactId, metadata = {}) {
    try {
      // Get current artifacts state
      const artifacts = await this.sharedState.get('artifacts') || {
        latest: {}
      };
      
      // Add artifact
      const artifact = {
        id: artifactId,
        type: artifactType,
        createdAt: Date.now(),
        ...metadata
      };
      
      // Set as latest for this type
      artifacts.latest[artifactType] = artifact;
      
      // Track all artifacts of this type if not already tracking
      if (!artifacts[artifactType]) {
        artifacts[artifactType] = [];
      }
      
      artifacts[artifactType].push(artifact);
      
      // Save updated artifacts state
      await this.sharedState.set('artifacts', artifacts);
      
      // Publish artifact tracked event
      await this.messageQueue.publish('artifact.tracked', {
        artifactType,
        artifactId,
        artifact,
        timestamp: Date.now()
      });
      
      logger.info(`Tracked artifact ${artifactId} of type ${artifactType}`);
      
      return artifact;
    } catch (error) {
      logger.error(`Error tracking artifact: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the latest artifact of a specific type
   * @param {String} artifactType - The type of artifact
   * @returns {Object} The latest artifact or null
   */
  async getLatestArtifact(artifactType) {
    try {
      // Get current artifacts state
      const artifacts = await this.sharedState.get('artifacts') || {
        latest: {}
      };
      
      return artifacts.latest[artifactType] || null;
    } catch (error) {
      logger.error(`Error getting latest artifact of type ${artifactType}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle system state change request
   * @param {Object} message - The state change request message
   */
  async handleStateChangeRequest(message) {
    try {
      const { component, update, requesterId } = message;
      
      logger.info(`State change requested by ${requesterId} for component ${component}`);
      
      // Update the state
      await this.updateState(component, update);
    } catch (error) {
      logger.error(`Error handling state change request: ${error.message}`);
      
      // Notify requestor about the error
      if (message.requesterId) {
        await this.messageQueue.publish(`${message.requesterId}.state_change_failed`, {
          component: message.component,
          error: error.message
        });
      }
    }
  }

  /**
   * Handle agent state change request
   * @param {Object} message - The agent state change request message
   */
  async handleAgentStateChangeRequest(message) {
    try {
      const { agentName, status, requesterId } = message;
      
      logger.info(`Agent state change requested by ${requesterId} for agent ${agentName}`);
      
      // Update the agent status
      await this.updateAgentStatus(agentName, status);
    } catch (error) {
      logger.error(`Error handling agent state change request: ${error.message}`);
      
      // Notify requestor about the error
      if (message.requesterId) {
        await this.messageQueue.publish(`${message.requesterId}.agent_state_change_failed`, {
          agentName: message.agentName,
          error: error.message
        });
      }
    }
  }

  /**
   * Handle task state change request
   * @param {Object} message - The task state change request message
   */
  async handleTaskStateChangeRequest(message) {
    try {
      const { taskId, status, additionalData, requesterId } = message;
      
      logger.info(`Task state change requested by ${requesterId} for task ${taskId}`);
      
      // Update the task status
      await this.updateTaskStatus(taskId, status, additionalData);
    } catch (error) {
      logger.error(`Error handling task state change request: ${error.message}`);
      
      // Notify requestor about the error
      if (message.requesterId) {
        await this.messageQueue.publish(`${message.requesterId}.task_state_change_failed`, {
          taskId: message.taskId,
          error: error.message
        });
      }
    }
  }
}

module.exports = StateManager;
