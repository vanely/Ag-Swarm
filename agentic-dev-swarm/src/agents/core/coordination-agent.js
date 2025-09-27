const BaseAgent = require('../base-agent');
const { getModelClient } = require('../../models/model-orchestrator');
const VectorDb = require('../../core/memory/vector-db');
const KnowledgeBase = require('../../core/memory/knowledge-base');
const MessageQueue = require('../../core/communication/message-queue');
const SharedState = require('../../core/communication/shared-state');
const TaskRouter = require('../../core/orchestration/task-router');
const StateManager = require('../../core/orchestration/state-manager');
const logger = require('../../utils/logger');

/**
 * CoordinationAgent class responsible for orchestrating the swarm,
 * managing inter-agent communication, conflict resolution,
 * and ensuring coherent system behavior
 */
class CoordinationAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      agentName: 'coordination-agent',
      agentDescription: 'Responsible for orchestrating the swarm, managing communication, and ensuring coherent behavior',
      defaultModel: 'gpt-4-turbo',
      ...config
    });
    
    this.vectorDb = new VectorDb();
    this.knowledgeBase = new KnowledgeBase();
    this.messageQueue = new MessageQueue();
    this.sharedState = new SharedState();
    this.taskRouter = new TaskRouter();
    this.stateManager = new StateManager();
    
    this.agentRegistry = {};
    this.systemState = {
      phase: 'initialization',
      activeAgents: [],
      pendingTasks: [],
      completedTasks: [],
      issues: []
    };
  }

  /**
   * Initialize the coordination agent
   */
  async initialize() {
    await super.initialize();
    logger.info(`${this.agentName} initialized with models: ${this.modelClient.modelName}`);
    
    // Register all event listeners
    this.registerEventListeners();
    
    // Load coordination-specific knowledge
    await this.loadCoordinationKnowledge();
    
    // Initialize system state
    await this.initializeSystemState();
  }

  /**
   * Register all event listeners for coordination
   */
  registerEventListeners() {
    // Listen for agent initialization events
    this.messageQueue.subscribe('agent.initialized', this.handleAgentInitialized.bind(this));
    
    // Listen for phase transition events
    this.messageQueue.subscribe('planning.completed', this.handlePlanningCompleted.bind(this));
    this.messageQueue.subscribe('development.completed', this.handleDevelopmentCompleted.bind(this));
    this.messageQueue.subscribe('integration.completed', this.handleIntegrationCompleted.bind(this));
    this.messageQueue.subscribe('deployment.completed', this.handleDeploymentCompleted.bind(this));
    
    // Listen for agent task events
    this.messageQueue.subscribe('agent.task_started', this.handleTaskStarted.bind(this));
    this.messageQueue.subscribe('agent.task_completed', this.handleTaskCompleted.bind(this));
    this.messageQueue.subscribe('agent.task_failed', this.handleTaskFailed.bind(this));
    
    // Listen for conflict events
    this.messageQueue.subscribe('system.conflict_detected', this.handleConflictDetected.bind(this));
    
    // Listen for error events
    this.messageQueue.subscribe('system.error', this.handleSystemError.bind(this));
  }

  /**
   * Load coordination-specific knowledge into memory systems
   */
  async loadCoordinationKnowledge() {
    try {
      // Load coordination strategies
      await this.knowledgeBase.loadKnowledge('coordination.strategies');
      
      // Load conflict resolution patterns
      await this.knowledgeBase.loadKnowledge('coordination.conflict_resolution');
      
      // Load phase transition rules
      await this.knowledgeBase.loadKnowledge('coordination.phase_transitions');
      
      logger.info(`${this.agentName} loaded coordination knowledge successfully`);
    } catch (error) {
      logger.error(`Error loading coordination knowledge: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initialize system state
   */
  async initializeSystemState() {
    // Load any existing state
    const existingState = await this.sharedState.get('system.state');
    
    if (existingState) {
      this.systemState = existingState;
    } else {
      // Set initial state
      this.systemState = {
        phase: 'initialization',
        activeAgents: [],
        pendingTasks: [],
        completedTasks: [],
        issues: []
      };
      
      // Save initial state
      await this.sharedState.set('system.state', this.systemState);
    }
    
    // Publish system state
    await this.messageQueue.publish('system.state_updated', this.systemState);
  }

  /**
   * Register an agent in the coordination system
   * @param {String} agentName - The name of the agent
   * @param {Object} agentInfo - Information about the agent
   */
  async registerAgent(agentName, agentInfo) {
    this.agentRegistry[agentName] = {
      ...agentInfo,
      status: 'active',
      lastHeartbeat: Date.now()
    };
    
    // Update active agents in system state
    this.systemState.activeAgents.push(agentName);
    
    // Update system state
    await this.updateSystemState();
    
    logger.info(`Registered agent ${agentName} in the coordination system`);
  }

  /**
   * Update system state and notify relevant components
   */
  async updateSystemState() {
    // Save updated state
    await this.sharedState.set('system.state', this.systemState);
    
    // Publish system state update
    await this.messageQueue.publish('system.state_updated', this.systemState);
  }

  /**
   * Initiate a phase transition in the development process
   * @param {String} newPhase - The new phase to transition to
   * @returns {Boolean} Success status of the transition
   */
  async initiatePhaseTransition(newPhase) {
    const currentPhase = this.systemState.phase;
    const phaseTransitionRules = await this.knowledgeBase.retrieveKnowledge('coordination.phase_transitions');
    
    logger.info(`Attempting phase transition from ${currentPhase} to ${newPhase}`);
    
    // Check if transition is valid
    const validTransition = phaseTransitionRules.validTransitions[currentPhase]?.includes(newPhase);
    
    if (!validTransition) {
      logger.error(`Invalid phase transition from ${currentPhase} to ${newPhase}`);
      return false;
    }
    
    // Check if transition preconditions are met
    const preconditionsMet = await this.checkPhaseTransitionPreconditions(currentPhase, newPhase);
    
    if (!preconditionsMet) {
      logger.error(`Preconditions not met for transition from ${currentPhase} to ${newPhase}`);
      return false;
    }
    
    // Update system phase
    this.systemState.phase = newPhase;
    
    // Clear and initialize phase-specific state
    this.systemState.pendingTasks = [];
    
    // Generate tasks for the new phase
    const phaseTasks = await this.generatePhaseSpecificTasks(newPhase);
    this.systemState.pendingTasks = phaseTasks;
    
    // Update system state
    await this.updateSystemState();
    
    // Notify all agents about the phase transition
    await this.messageQueue.publish('system.phase_changed', {
      previousPhase: currentPhase,
      currentPhase: newPhase,
      tasks: phaseTasks
    });
    
    logger.info(`Successfully transitioned from ${currentPhase} to ${newPhase}`);
    return true;
  }

  /**
   * Check if preconditions are met for a phase transition
   * @param {String} currentPhase - The current phase
   * @param {String} targetPhase - The target phase
   * @returns {Boolean} Whether preconditions are met
   */
  async checkPhaseTransitionPreconditions(currentPhase, targetPhase) {
    const phaseTransitionRules = await this.knowledgeBase.retrieveKnowledge('coordination.phase_transitions');
    const preconditions = phaseTransitionRules.preconditions[targetPhase] || [];
    
    // Check all preconditions
    for (const precondition of preconditions) {
      const result = await this.evaluatePrecondition(precondition);
      if (!result) {
        logger.warn(`Precondition failed for transition to ${targetPhase}: ${precondition}`);
        return false;
      }
    }
    
    return true;
  }

  /**
   * Evaluate a specific precondition
   * @param {Object} precondition - The precondition to evaluate
   * @returns {Boolean} Whether the precondition is met
   */
  async evaluatePrecondition(precondition) {
    switch (precondition.type) {
      case 'task_completion':
        // Check if specific tasks are completed
        return this.systemState.completedTasks.some(task => 
          task.type === precondition.taskType && task.status === 'completed'
        );
        
      case 'artifact_existence':
        // Check if specific artifacts exist
        const artifactExists = await this.knowledgeBase.retrieveKnowledge(precondition.artifactPath);
        return !!artifactExists;
        
      case 'agent_status':
        // Check if specific agents are active
        const agent = this.agentRegistry[precondition.agentName];
        return agent && agent.status === precondition.status;
        
      case 'no_pending_tasks':
        // Check if there are no pending tasks
        return this.systemState.pendingTasks.length === 0;
        
      case 'no_errors':
        // Check if there are no unresolved errors
        return this.systemState.issues.filter(issue => !issue.resolved).length === 0;
        
      default:
        logger.warn(`Unknown precondition type: ${precondition.type}`);
        return false;
    }
  }

  /**
   * Generate phase-specific tasks
   * @param {String} phase - The phase to generate tasks for
   * @returns {Array} The generated tasks
   */
  async generatePhaseSpecificTasks(phase) {
    const prompt = this.createPrompt('generate_phase_tasks', {
      phase,
      systemState: this.systemState,
      agentRegistry: this.agentRegistry
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const tasks = JSON.parse(response);
      
      // Add task IDs and metadata
      const tasksWithIds = tasks.map(task => ({
        ...task,
        id: `${phase}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: Date.now(),
        status: 'pending',
        attempts: 0
      }));
      
      return tasksWithIds;
    } catch (error) {
      logger.error(`Error parsing phase tasks: ${error.message}`);
      throw new Error(`Failed to generate tasks for phase ${phase}: ${error.message}`);
    }
  }

  /**
   * Assign a task to an appropriate agent
   * @param {Object} task - The task to assign
   * @returns {String} The agent the task was assigned to
   */
  async assignTask(task) {
    // Use the task router to determine the best agent for this task
    const assignedAgent = await this.taskRouter.routeTask(task, this.agentRegistry);
    
    if (!assignedAgent) {
      logger.error(`No suitable agent found for task: ${task.id}`);
      throw new Error(`No suitable agent found for task: ${task.id}`);
    }
    
    // Update task status
    task.status = 'assigned';
    task.assignedAgent = assignedAgent;
    task.assignedAt = Date.now();
    
    // Notify the agent about the assigned task
    await this.messageQueue.publish(`${assignedAgent}.task_assigned`, { task });
    
    logger.info(`Assigned task ${task.id} to agent ${assignedAgent}`);
    
    return assignedAgent;
  }

  /**
   * Process and assign all pending tasks
   */
  async processPendingTasks() {
    const pendingTasks = this.systemState.pendingTasks.filter(task => task.status === 'pending');
    
    for (const task of pendingTasks) {
      try {
        await this.assignTask(task);
      } catch (error) {
        logger.error(`Failed to assign task ${task.id}: ${error.message}`);
        
        // Update task status
        task.status = 'failed';
        task.error = error.message;
        
        // Add to issues
        this.systemState.issues.push({
          type: 'task_assignment_failure',
          taskId: task.id,
          message: error.message,
          timestamp: Date.now(),
          resolved: false
        });
      }
    }
    
    // Update system state
    await this.updateSystemState();
  }

  /**
   * Detect and resolve conflicts between agents or tasks
   * @param {Object} conflict - The detected conflict
   * @returns {Object} The resolution result
   */
  async resolveConflict(conflict) {
    const conflictResolutionStrategies = await this.knowledgeBase.retrieveKnowledge('coordination.conflict_resolution');
    
    // Determine the appropriate resolution strategy
    let strategyName;
    switch (conflict.type) {
      case 'resource_conflict':
        strategyName = 'priority_based';
        break;
      case 'data_inconsistency':
        strategyName = 'latest_update_wins';
        break;
      case 'task_dependency':
        strategyName = 'dependency_resolution';
        break;
      case 'agent_disagreement':
        strategyName = 'voting';
        break;
      default:
        strategyName = 'default';
    }
    
    const strategy = conflictResolutionStrategies[strategyName];
    
    const prompt = this.createPrompt('resolve_conflict', {
      conflict,
      strategy,
      systemState: this.systemState
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const resolution = JSON.parse(response);
      
      // Implement the resolution
      await this.implementConflictResolution(conflict, resolution);
      
      // Update conflict status
      conflict.status = 'resolved';
      conflict.resolution = resolution;
      
      // Log resolution
      logger.info(`Resolved conflict ${conflict.id} using ${strategyName} strategy`);
      
      return resolution;
    } catch (error) {
      logger.error(`Error resolving conflict: ${error.message}`);
      throw new Error(`Failed to resolve conflict: ${error.message}`);
    }
  }

  /**
   * Implement a conflict resolution
   * @param {Object} conflict - The conflict
   * @param {Object} resolution - The resolution
   */
  async implementConflictResolution(conflict, resolution) {
    // Implementation depends on the resolution type
    switch (resolution.type) {
      case 'task_reordering':
        // Reorder tasks based on priorities
        for (const taskUpdate of resolution.taskUpdates) {
          const task = this.systemState.pendingTasks.find(t => t.id === taskUpdate.id);
          if (task) {
            task.priority = taskUpdate.newPriority;
          }
        }
        break;
        
      case 'data_update':
        // Update shared state with resolved data
        for (const stateUpdate of resolution.stateUpdates) {
          await this.sharedState.set(stateUpdate.key, stateUpdate.value);
        }
        break;
        
      case 'agent_override':
        // Notify agents about overrides
        for (const agentOverride of resolution.agentOverrides) {
          await this.messageQueue.publish(`${agentOverride.agent}.override`, {
            overrideType: agentOverride.type,
            data: agentOverride.data
          });
        }
        break;
        
      case 'workflow_modification':
        // Modify workflow rules
        // This might require updating the knowledge base
        await this.knowledgeBase.storeKnowledge(
          'coordination.workflow_rules',
          resolution.newWorkflowRules
        );
        break;
    }
    
    // Notify relevant agents about the resolution
    for (const agent of resolution.affectedAgents) {
      await this.messageQueue.publish(`${agent}.conflict_resolved`, {
        conflict,
        resolution
      });
    }
  }

  /**
   * Generate a system status report
   * @returns {Object} The status report
   */
  async generateStatusReport() {
    const prompt = this.createPrompt('generate_status_report', {
      systemState: this.systemState,
      agentRegistry: this.agentRegistry
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const statusReport = JSON.parse(response);
      
      // Store the status report
      await this.knowledgeBase.storeKnowledge('system.status_reports', {
        timestamp: Date.now(),
        report: statusReport
      });
      
      // Publish status report
      await this.messageQueue.publish('system.status_report', statusReport);
      
      return statusReport;
    } catch (error) {
      logger.error(`Error generating status report: ${error.message}`);
      throw new Error(`Failed to generate status report: ${error.message}`);
    }
  }

  /**
   * Handle agent initialized events
   * @param {Object} message - The message containing agent initialization info
   */
  async handleAgentInitialized(message) {
    const { agentName, agentInfo } = message;
    logger.info(`Agent ${agentName} initialized`);
    
    // Register the agent
    await this.registerAgent(agentName, agentInfo);
    
    // Check if all agents are initialized to move to planning phase
    const allAgentsInitialized = [
      'planning-agent',
      'frontend-agent',
      'backend-agent',
      'devops-agent',
      'security-agent',
      'qa-agent'
    ].every(agent => this.agentRegistry[agent]);
    
    if (allAgentsInitialized && this.systemState.phase === 'initialization') {
      // Transition to planning phase
      await this.initiatePhaseTransition('planning');
    }
  }

  /**
   * Handle planning completed events
   * @param {Object} message - The message containing planning completion info
   */
  async handlePlanningCompleted(message) {
    logger.info(`Planning phase completed: ${JSON.stringify(message)}`);
    
    // Transition to development phase
    await this.initiatePhaseTransition('development');
  }

  /**
   * Handle development completed events
   * @param {Object} message - The message containing development completion info
   */
  async handleDevelopmentCompleted(message) {
    logger.info(`Development phase completed: ${JSON.stringify(message)}`);
    
    // Transition to integration phase
    await this.initiatePhaseTransition('integration');
  }

  /**
   * Handle integration completed events
   * @param {Object} message - The message containing integration completion info
   */
  async handleIntegrationCompleted(message) {
    logger.info(`Integration phase completed: ${JSON.stringify(message)}`);
    
    // Transition to deployment phase
    await this.initiatePhaseTransition('deployment');
  }

  /**
   * Handle deployment completed events
   * @param {Object} message - The message containing deployment completion info
   */
  async handleDeploymentCompleted(message) {
    logger.info(`Deployment phase completed: ${JSON.stringify(message)}`);
    
    // Finalize the project
    await this.finalizeProject(message);
  }

  /**
   * Finalize the project after successful deployment
   * @param {Object} deploymentInfo - Information about the deployment
   */
  async finalizeProject(deploymentInfo) {
    // Generate final status report
    const finalStatus = await this.generateStatusReport();
    
    // Gather all project artifacts
    const projectArtifacts = {
      planning: await this.knowledgeBase.retrieveKnowledge('planning'),
      frontend: await this.knowledgeBase.retrieveKnowledge('frontend'),
      backend: await this.knowledgeBase.retrieveKnowledge('backend'),
      devops: await this.knowledgeBase.retrieveKnowledge('devops'),
      security: await this.knowledgeBase.retrieveKnowledge('security'),
      qa: await this.knowledgeBase.retrieveKnowledge('qa')
    };
    
    // Create project summary
    const prompt = this.createPrompt('create_project_summary', {
      projectArtifacts,
      deploymentInfo,
      finalStatus
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const projectSummary = JSON.parse(response);
      
      // Store the project summary
      await this.knowledgeBase.storeKnowledge('system.project_summary', projectSummary);
      
      // Publish project completion
      await this.messageQueue.publish('system.project_completed', {
        projectSummary,
        deploymentInfo
      });
      
      // Update system state
      this.systemState.phase = 'completed';
      await this.updateSystemState();
      
      logger.info(`Project successfully completed and finalized`);
    } catch (error) {
      logger.error(`Error creating project summary: ${error.message}`);
      throw new Error(`Failed to finalize project: ${error.message}`);
    }
  }

  /**
   * Handle task started events
   * @param {Object} message - The message containing task start info
   */
  async handleTaskStarted(message) {
    const { agentName, taskId } = message;
    
    // Find the task
    const taskIndex = this.systemState.pendingTasks.findIndex(task => task.id === taskId);
    
    if (taskIndex >= 0) {
      const task = this.systemState.pendingTasks[taskIndex];
      task.status = 'in_progress';
      task.startedAt = Date.now();
      
      // Update system state
      await this.updateSystemState();
      
      logger.info(`Task ${taskId} started by agent ${agentName}`);
    } else {
      logger.warn(`Task ${taskId} not found in pending tasks`);
    }
  }

  /**
   * Handle task completed events
   * @param {Object} message - The message containing task completion info
   */
  async handleTaskCompleted(message) {
    const { agentName, taskId, result } = message;
    
    // Find the task
    const taskIndex = this.systemState.pendingTasks.findIndex(task => task.id === taskId);
    
    if (taskIndex >= 0) {
      const task = this.systemState.pendingTasks[taskIndex];
      
      // Remove from pending tasks
      this.systemState.pendingTasks.splice(taskIndex, 1);
      
      // Add to completed tasks
      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = result;
      
      this.systemState.completedTasks.push(task);
      
      // Update system state
      await this.updateSystemState();
      
      logger.info(`Task ${taskId} completed by agent ${agentName}`);
      
      // Check if all tasks in the current phase are completed
      const allTasksCompleted = this.systemState.pendingTasks.length === 0 ||
        !this.systemState.pendingTasks.some(t => t.phase === this.systemState.phase);
      
      if (allTasksCompleted) {
        // Notify phase completion
        await this.messageQueue.publish(`${this.systemState.phase}.completed`, {
          phase: this.systemState.phase,
          completedTasks: this.systemState.completedTasks.filter(t => t.phase === this.systemState.phase)
        });
      } else {
        // Process remaining tasks
        await this.processPendingTasks();
      }
    } else {
      logger.warn(`Task ${taskId} not found in pending tasks`);
    }
  }

  /**
   * Handle task failed events
   * @param {Object} message - The message containing task failure info
   */
  async handleTaskFailed(message) {
    const { agentName, taskId, error } = message;
    
    // Find the task
    const taskIndex = this.systemState.pendingTasks.findIndex(task => task.id === taskId);
    
    if (taskIndex >= 0) {
      const task = this.systemState.pendingTasks[taskIndex];
      
      // Update task status
      task.status = 'failed';
      task.error = error;
      task.attempts = (task.attempts || 0) + 1;
      
      // Add to issues
      this.systemState.issues.push({
        type: 'task_failure',
        taskId: task.id,
        message: error,
        timestamp: Date.now(),
        resolved: false
      });
      
      // Check retry policy
      const maxRetries = task.maxRetries || 3;
      
      if (task.attempts < maxRetries) {
        // Reset task for retry
        task.status = 'pending';
        
        logger.info(`Task ${taskId} failed, will retry (attempt ${task.attempts}/${maxRetries})`);
      } else {
        // Move to failed tasks
        this.systemState.pendingTasks.splice(taskIndex, 1);
        
        logger.error(`Task ${taskId} failed after ${task.attempts} attempts, no more retries`);
        
        // Notify about critical task failure
        await this.messageQueue.publish('system.critical_task_failure', {
          task,
          agent: agentName,
          error
        });
      }
      
      // Update system state
      await this.updateSystemState();
    } else {
      logger.warn(`Task ${taskId} not found in pending tasks`);
    }
  }

  /**
   * Handle conflict detected events
   * @param {Object} message - The message containing conflict info
   */
  async handleConflictDetected(message) {
    const conflict = message.conflict;
    logger.info(`Conflict detected: ${JSON.stringify(conflict)}`);
    
    try {
      // Resolve the conflict
      const resolution = await this.resolveConflict(conflict);
      
      // Log resolution
      logger.info(`Conflict ${conflict.id} resolved: ${JSON.stringify(resolution)}`);
    } catch (error) {
      logger.error(`Failed to resolve conflict ${conflict.id}: ${error.message}`);
      
      // Add to issues
      this.systemState.issues.push({
        type: 'conflict_resolution_failure',
        conflictId: conflict.id,
        message: error.message,
        timestamp: Date.now(),
        resolved: false
      });
      
      // Update system state
      await this.updateSystemState();
    }
  }

  /**
   * Handle system error events
   * @param {Object} message - The message containing error info
   */
  async handleSystemError(message) {
    const { source, error, severity } = message;
    
    // Log error
    logger.error(`System error from ${source}: ${error}`, { severity });
    
    // Add to issues
    this.systemState.issues.push({
      type: 'system_error',
      source,
      message: error,
      severity,
      timestamp: Date.now(),
      resolved: false
    });
    
    // Update system state
    await this.updateSystemState();
    
    // For critical errors, notify all agents
    if (severity === 'critical') {
      await this.messageQueue.publish('system.critical_error', {
        source,
        error,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Create a prompt for the model with appropriate context
   * @param {String} promptType - The type of prompt to create
   * @param {Object} contextData - The context data for the prompt
   * @returns {String} The complete prompt
   */
  createPrompt(promptType, contextData) {
    const basePrompt = `You are an expert coordination and orchestration AI agent. Your task is to ${this.getPromptInstructionsByType(promptType)}.
    
Current timestamp: ${new Date().toISOString()}
Task: ${promptType}

`;
    
    const contextString = JSON.stringify(contextData, null, 2);
    
    return `${basePrompt}
Context:
${contextString}

Response format: JSON

`;
  }

  /**
   * Get specific instructions based on prompt type
   * @param {String} promptType - The type of prompt
   * @returns {String} The specific instructions
   */
  getPromptInstructionsByType(promptType) {
    const instructionMap = {
      generate_phase_tasks: 'generate tasks for a specific development phase',
      resolve_conflict: 'resolve a conflict between agents or tasks',
      generate_status_report: 'generate a comprehensive system status report',
      create_project_summary: 'create a detailed project summary after completion'
    };
    
    return instructionMap[promptType] || 'perform a coordination task';
  }
}

module.exports = CoordinationAgent;
