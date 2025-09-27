/**
 * Coordination module for the Agentic Software Development Swarm
 * 
 * This module provides high-level coordination patterns for agents
 * to collaborate effectively.
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');
const MessageQueue = require('./message-queue');
const SharedState = require('./shared-state');

class Coordination extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      taskAssignmentTopic: config.taskAssignmentTopic || 'task-assignments',
      taskCompletionTopic: config.taskCompletionTopic || 'task-completions',
      taskStatusTopic: config.taskStatusTopic || 'task-status',
      taskDependencyTopic: config.taskDependencyTopic || 'task-dependencies',
      conflictResolution: config.conflictResolution || 'majority-vote',
      qualityGatesEnabled: config.qualityGatesEnabled !== false,
      reviewRequired: config.reviewRequired !== false,
      maxConcurrentTasks: config.maxConcurrentTasks || 5,
      taskTimeout: config.taskTimeout || 300000, // 5 minutes
      ...config
    };
    
    // Initialize communication channels
    this.messageQueue = new MessageQueue(config.messageQueue || {});
    this.sharedState = new SharedState(config.sharedState || {});
    
    // Task tracking
    this.taskChannels = new Map();
    this.taskReviewers = new Map();
    this.activeTasks = new Map();
    this.pendingTasks = new Map();
    this.completedTasks = new Map();
    this.taskTimeouts = new Map();
    
    // Node identity
    this.nodeId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.isInitialized = false;
    
    logger.info('Coordination module initialized');
    logger.debug(`Coordination configuration: ${JSON.stringify(this.config)}`);
  }
  
  /**
   * Initialize the coordination module
   */
  async initialize() {
    if (this.isInitialized) {
      logger.warn('Coordination module already initialized');
      return;
    }
    
    try {
      // Connect to message queue
      await this.messageQueue.connect();
      
      // Initialize shared state
      await this.sharedState.initialize();
      
      // Set up task assignment channel
      this.assignmentChannel = await this.messageQueue.createBroadcastChannel(
        this.config.taskAssignmentTopic
      );
      
      // Set up task completion channel
      this.completionChannel = await this.messageQueue.createBroadcastChannel(
        this.config.taskCompletionTopic
      );
      
      // Set up task status service
      this.statusService = await this.messageQueue.createRequestResponse(
        this.config.taskStatusTopic
      );
      
      // Handle status queries
      await this.statusService.handleRequests(this.handleStatusQuery.bind(this));
      
      // Set up task dependency tracking
      await this.sharedState.set('taskDependencies', {}, { nodeId: this.nodeId });
      
      // Subscribe to task assignments
      await this.assignmentChannel.subscribe(
        this.nodeId,
        this.handleTaskAssignment.bind(this)
      );
      
      // Subscribe to task completions
      await this.completionChannel.subscribe(
        this.nodeId,
        this.handleTaskCompletion.bind(this)
      );
      
      this.isInitialized = true;
      
      logger.info(`Coordination module initialized with node ID ${this.nodeId}`);
      this.emit('initialized', { nodeId: this.nodeId });
      
      return true;
    } catch (error) {
      logger.error(`Failed to initialize Coordination module: ${error.message}`);
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Handle a task assignment message
   * 
   * @param {Object} assignment - Task assignment message
   * @param {Object} metadata - Message metadata
   */
  async handleTaskAssignment(assignment, metadata) {
    logger.debug(`Received task assignment: ${JSON.stringify(assignment)}`);
    
    // Check if this assignment is for us
    if (assignment.assignedTo !== this.nodeId && assignment.assignedTo !== 'all') {
      return;
    }
    
    try {
      // Check if we already have this task
      if (this.activeTasks.has(assignment.taskId) || this.completedTasks.has(assignment.taskId)) {
        return;
      }
      
      // Check task dependencies
      const dependencies = await this.getTaskDependencies(assignment.taskId);
      
      if (dependencies.length > 0) {
        // Check if all dependencies are completed
        const allDependenciesCompleted = await this.checkDependenciesCompleted(dependencies);
        
        if (!allDependenciesCompleted) {
          // Add to pending tasks
          this.pendingTasks.set(assignment.taskId, {
            task: assignment.task,
            dependencies,
            timestamp: Date.now()
          });
          
          logger.info(`Task ${assignment.taskId} added to pending tasks due to unresolved dependencies`);
          
          return;
        }
      }
      
      // Add to active tasks
      this.activeTasks.set(assignment.taskId, {
        task: assignment.task,
        assignedAt: Date.now(),
        status: 'assigned'
      });
      
      // Set timeout for the task
      this.taskTimeouts.set(assignment.taskId, setTimeout(() => {
        this.handleTaskTimeout(assignment.taskId);
      }, this.config.taskTimeout));
      
      // Notify listeners
      this.emit('task:assigned', {
        taskId: assignment.taskId,
        task: assignment.task
      });
      
      logger.info(`Task ${assignment.taskId} assigned`);
    } catch (error) {
      logger.error(`Error handling task assignment: ${error.message}`);
    }
  }
  
  /**
   * Handle a task completion message
   * 
   * @param {Object} completion - Task completion message
   * @param {Object} metadata - Message metadata
   */
  async handleTaskCompletion(completion, metadata) {
    logger.debug(`Received task completion: ${JSON.stringify(completion)}`);
    
    try {
      // Update local task tracking
      if (this.activeTasks.has(completion.taskId)) {
        // Remove from active tasks
        this.activeTasks.delete(completion.taskId);
        
        // Clear timeout
        if (this.taskTimeouts.has(completion.taskId)) {
          clearTimeout(this.taskTimeouts.get(completion.taskId));
          this.taskTimeouts.delete(completion.taskId);
        }
      }
      
      // Add to completed tasks
      this.completedTasks.set(completion.taskId, {
        task: completion.task,
        result: completion.result,
        completedAt: completion.timestamp,
        completedBy: completion.completedBy
      });
      
      // Check if we have any pending tasks that depend on this one
      await this.checkPendingTasks();
      
      // Notify listeners
      this.emit('task:completed', {
        taskId: completion.taskId,
        task: completion.task,
        result: completion.result,
        completedBy: completion.completedBy
      });
      
      logger.info(`Task ${completion.taskId} completed by ${completion.completedBy}`);
    } catch (error) {
      logger.error(`Error handling task completion: ${error.message}`);
    }
  }
  
  /**
   * Handle a task timeout
   * 
   * @param {string} taskId - ID of the timed out task
   */
  async handleTaskTimeout(taskId) {
    logger.warn(`Task ${taskId} timed out`);
    
    try {
      // Check if the task is still active
      if (!this.activeTasks.has(taskId)) {
        return;
      }
      
      const taskInfo = this.activeTasks.get(taskId);
      
      // Update task status
      taskInfo.status = 'timed-out';
      
      // Notify listeners
      this.emit('task:timeout', {
        taskId,
        task: taskInfo.task
      });
      
      // Reassign the task or handle the timeout
      await this.reassignTask(taskId, taskInfo.task, 'timeout');
    } catch (error) {
      logger.error(`Error handling task timeout: ${error.message}`);
    }
  }
  
  /**
   * Reassign a task to another node
   * 
   * @param {string} taskId - ID of the task
   * @param {Object} task - Task data
   * @param {string} reason - Reason for reassignment
   */
  async reassignTask(taskId, task, reason) {
    try {
      logger.info(`Reassigning task ${taskId} due to ${reason}`);
      
      // Remove from our active tasks
      this.activeTasks.delete(taskId);
      
      // Clear timeout if exists
      if (this.taskTimeouts.has(taskId)) {
        clearTimeout(this.taskTimeouts.get(taskId));
        this.taskTimeouts.delete(taskId);
      }
      
      // Broadcast reassignment
      await this.assignmentChannel.broadcast({
        type: 'task-reassignment',
        taskId,
        task,
        assignedTo: 'all', // Let any available node take it
        previousAssignee: this.nodeId,
        reason,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error reassigning task ${taskId}: ${error.message}`);
    }
  }
  
  /**
   * Handle a status query
   * 
   * @param {Object} query - Status query
   * @param {Object} metadata - Query metadata
   * @returns {Object} Status response
   */
  async handleStatusQuery(query, metadata) {
    logger.debug(`Received status query: ${JSON.stringify(query)}`);
    
    try {
      if (query.type === 'task-status') {
        // Handle task status query
        const taskId = query.taskId;
        
        if (this.activeTasks.has(taskId)) {
          return {
            taskId,
            status: this.activeTasks.get(taskId).status,
            assignedTo: this.nodeId,
            timestamp: Date.now()
          };
        } else if (this.completedTasks.has(taskId)) {
          const completedTask = this.completedTasks.get(taskId);
          
          return {
            taskId,
            status: 'completed',
            result: completedTask.result,
            completedAt: completedTask.completedAt,
            completedBy: completedTask.completedBy,
            timestamp: Date.now()
          };
        } else if (this.pendingTasks.has(taskId)) {
          return {
            taskId,
            status: 'pending',
            dependencies: await this.getTaskDependencies(taskId),
            timestamp: Date.now()
          };
        } else {
          return {
            taskId,
            status: 'unknown',
            timestamp: Date.now()
          };
        }
      } else if (query.type === 'node-status') {
        // Handle node status query
        return {
          nodeId: this.nodeId,
          activeTasks: Array.from(this.activeTasks.keys()),
          pendingTasks: Array.from(this.pendingTasks.keys()),
          completedTasks: Array.from(this.completedTasks.keys()),
          load: this.activeTasks.size,
          maxLoad: this.config.maxConcurrentTasks,
          timestamp: Date.now()
        };
      } else if (query.type === 'dependency-status') {
        // Handle dependency status query
        const taskId = query.taskId;
        const dependencies = await this.getTaskDependencies(taskId);
        const dependencyStatus = await this.getDependencyStatus(dependencies);
        
        return {
          taskId,
          dependencies,
          status: dependencyStatus,
          allCompleted: Object.values(dependencyStatus).every(status => status === 'completed'),
          timestamp: Date.now()
        };
      } else {
        return {
          error: `Unknown query type: ${query.type}`,
          timestamp: Date.now()
        };
      }
    } catch (error) {
      logger.error(`Error handling status query: ${error.message}`);
      
      return {
        error: error.message,
        timestamp: Date.now()
      };
    }
  }
  
  /**
   * Check all pending tasks to see if their dependencies are now satisfied
   */
  async checkPendingTasks() {
    if (this.pendingTasks.size === 0) {
      return;
    }
    
    const pendingTaskIds = Array.from(this.pendingTasks.keys());
    
    for (const taskId of pendingTaskIds) {
      const pendingTask = this.pendingTasks.get(taskId);
      const dependencies = pendingTask.dependencies;
      
      // Check if all dependencies are completed
      const allDependenciesCompleted = await this.checkDependenciesCompleted(dependencies);
      
      if (allDependenciesCompleted) {
        // Remove from pending tasks
        this.pendingTasks.delete(taskId);
        
        // Add to active tasks
        this.activeTasks.set(taskId, {
          task: pendingTask.task,
          assignedAt: Date.now(),
          status: 'assigned'
        });
        
        // Set timeout for the task
        this.taskTimeouts.set(taskId, setTimeout(() => {
          this.handleTaskTimeout(taskId);
        }, this.config.taskTimeout));
        
        // Notify listeners
        this.emit('task:activated', {
          taskId,
          task: pendingTask.task,
          previouslyPending: true
        });
        
        logger.info(`Pending task ${taskId} activated as dependencies are now satisfied`);
      }
    }
  }
  
  /**
   * Check if all dependencies for a task are completed
   * 
   * @param {Array} dependencies - Array of dependency task IDs
   * @returns {boolean} True if all dependencies are completed
   */
  async checkDependenciesCompleted(dependencies) {
    if (dependencies.length === 0) {
      return true;
    }
    
    const dependencyStatus = await this.getDependencyStatus(dependencies);
    
    return Object.values(dependencyStatus).every(status => status === 'completed');
  }
  
  /**
   * Get the status of a set of dependencies
   * 
   * @param {Array} dependencies - Array of dependency task IDs
   * @returns {Object} Map of task IDs to their status
   */
  async getDependencyStatus(dependencies) {
    const status = {};
    
    // First check our local knowledge
    for (const depId of dependencies) {
      if (this.completedTasks.has(depId)) {
        status[depId] = 'completed';
      } else if (this.activeTasks.has(depId)) {
        status[depId] = this.activeTasks.get(depId).status;
      } else if (this.pendingTasks.has(depId)) {
        status[depId] = 'pending';
      } else {
        // We don't know locally, need to query
        status[depId] = 'unknown';
      }
    }
    
    // Query for any unknown statuses
    const unknownDeps = dependencies.filter(depId => status[depId] === 'unknown');
    
    if (unknownDeps.length > 0) {
      for (const depId of unknownDeps) {
        try {
          const response = await this.statusService.request({
            type: 'task-status',
            taskId: depId
          }, { timeout: 5000 });
          
          if (response.status === 'completed') {
            // Add to our local completed tasks
            this.completedTasks.set(depId, {
              task: response.task,
              result: response.result,
              completedAt: response.completedAt,
              completedBy: response.completedBy
            });
          }
          
          status[depId] = response.status;
        } catch (error) {
          logger.error(`Error querying status for dependency ${depId}: ${error.message}`);
          // Keep as unknown
        }
      }
    }
    
    return status;
  }
  
  /**
   * Get dependencies for a task
   * 
   * @param {string} taskId - ID of the task
   * @returns {Array} Array of dependency task IDs
   */
  async getTaskDependencies(taskId) {
    const dependencies = await this.sharedState.get(['taskDependencies', taskId]);
    
    if (!dependencies || !Array.isArray(dependencies)) {
      return [];
    }
    
    return dependencies;
  }
  
  /**
   * Set dependencies for a task
   * 
   * @param {string} taskId - ID of the task
   * @param {Array} dependencies - Array of dependency task IDs
   */
  async setTaskDependencies(taskId, dependencies) {
    await this.sharedState.set(['taskDependencies', taskId], dependencies);
    
    logger.debug(`Set dependencies for task ${taskId}: ${dependencies.join(', ')}`);
  }
  
  /**
   * Assign a task to a specific node
   * 
   * @param {string} taskId - ID of the task
   * @param {Object} task - Task data
   * @param {string} assignTo - Node ID to assign to, or 'all' for any node
   * @param {Array} dependencies - Array of dependency task IDs
   * @returns {Object} Assignment result
   */
  async assignTask(taskId, task, assignTo = 'all', dependencies = []) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      // Set task dependencies
      if (dependencies.length > 0) {
        await this.setTaskDependencies(taskId, dependencies);
      }
      
      // Broadcast assignment
      await this.assignmentChannel.broadcast({
        type: 'task-assignment',
        taskId,
        task,
        assignedTo: assignTo,
        assignedBy: this.nodeId,
        timestamp: Date.now()
      });
      
      logger.info(`Task ${taskId} assigned to ${assignTo}`);
      
      return {
        success: true,
        taskId,
        assignedTo: assignTo,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Error assigning task ${taskId}: ${error.message}`);
      
      return {
        success: false,
        taskId,
        error: error.message
      };
    }
  }
  
  /**
   * Complete a task
   * 
   * @param {string} taskId - ID of the task
   * @param {Object} result - Task result
   * @param {boolean} requireReview - Whether this task requires review
   * @returns {Object} Completion result
   */
  async completeTask(taskId, result, requireReview = null) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    // Check if we have this task
    if (!this.activeTasks.has(taskId)) {
      throw new Error(`Task ${taskId} not found in active tasks`);
    }
    
    const taskInfo = this.activeTasks.get(taskId);
    
    try {
      // Determine if review is required
      const needsReview = requireReview !== null ? 
        requireReview : 
        this.config.reviewRequired && taskInfo.task.requireReview !== false;
      
      if (needsReview) {
        // Create a review task
        const reviewTaskId = `review-${taskId}`;
        const reviewTask = {
          type: 'review',
          originalTaskId: taskId,
          originalTask: taskInfo.task,
          result,
          submittedBy: this.nodeId,
          submittedAt: Date.now()
        };
        
        // Track the review task
        this.taskReviewers.set(reviewTaskId, {
          originalTaskId: taskId,
          submittedAt: Date.now()
        });
        
        // Assign to a reviewer (not ourselves)
        await this.assignTask(reviewTaskId, reviewTask, 'any-except:' + this.nodeId);
        
        // Update task status
        taskInfo.status = 'pending-review';
        
        logger.info(`Task ${taskId} submitted for review as ${reviewTaskId}`);
        
        return {
          success: true,
          taskId,
          status: 'pending-review',
          reviewTaskId,
          timestamp: Date.now()
        };
      } else {
        // No review required, complete immediately
        return await this.finalizeTask(taskId, result);
      }
    } catch (error) {
      logger.error(`Error completing task ${taskId}: ${error.message}`);
      
      return {
        success: false,
        taskId,
        error: error.message
      };
    }
  }
  
  /**
   * Review a task
   * 
   * @param {string} reviewTaskId - ID of the review task
   * @param {boolean} approved - Whether the task is approved
   * @param {Object} feedback - Review feedback
   * @returns {Object} Review result
   */
  async reviewTask(reviewTaskId, approved, feedback = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    // Check if we have this review task
    if (!this.activeTasks.has(reviewTaskId)) {
      throw new Error(`Review task ${reviewTaskId} not found in active tasks`);
    }
    
    // Check if this is a review task
    const reviewTask = this.activeTasks.get(reviewTaskId).task;
    
    if (reviewTask.type !== 'review') {
      throw new Error(`Task ${reviewTaskId} is not a review task`);
    }
    
    try {
      // Mark review task as completed
      await this.finalizeTask(reviewTaskId, {
        approved,
        feedback,
        reviewedBy: this.nodeId,
        reviewedAt: Date.now()
      });
      
      if (approved) {
        // Finalize the original task
        const originalTaskId = reviewTask.originalTaskId;
        
        await this.finalizeTask(originalTaskId, reviewTask.result, this.nodeId);
        
        logger.info(`Task ${originalTaskId} approved and finalized after review`);
        
        return {
          success: true,
          reviewTaskId,
          originalTaskId,
          status: 'approved',
          timestamp: Date.now()
        };
      } else {
        // Task was rejected, needs to be fixed
        const originalTaskId = reviewTask.originalTaskId;
        
        // Create a fix task
        const fixTaskId = `fix-${originalTaskId}-${Date.now()}`;
        const fixTask = {
          type: 'fix',
          originalTaskId,
          originalTask: reviewTask.originalTask,
          previousResult: reviewTask.result,
          feedback,
          rejectedBy: this.nodeId,
          rejectedAt: Date.now()
        };
        
        // Assign back to original submitter
        await this.assignTask(fixTaskId, fixTask, reviewTask.submittedBy);
        
        logger.info(`Task ${originalTaskId} rejected, fix task ${fixTaskId} created`);
        
        return {
          success: true,
          reviewTaskId,
          originalTaskId,
          status: 'rejected',
          fixTaskId,
          timestamp: Date.now()
        };
      }
    } catch (error) {
      logger.error(`Error reviewing task ${reviewTaskId}: ${error.message}`);
      
      return {
        success: false,
        reviewTaskId,
        error: error.message
      };
    }
  }
  
  /**
   * Finalize a task (mark as completed)
   * 
   * @param {string} taskId - ID of the task
   * @param {Object} result - Task result
   * @param {string} completedBy - Node ID that completed the task
   * @returns {Object} Finalization result
   */
  async finalizeTask(taskId, result, completedBy = null) {
    try {
      // Clear any timeout
      if (this.taskTimeouts.has(taskId)) {
        clearTimeout(this.taskTimeouts.get(taskId));
        this.taskTimeouts.delete(taskId);
      }
      
      // Remove from active tasks
      this.activeTasks.delete(taskId);
      
      // Add to completed tasks
      this.completedTasks.set(taskId, {
        task: this.activeTasks.get(taskId)?.task,
        result,
        completedAt: Date.now(),
        completedBy: completedBy || this.nodeId
      });
      
      // Broadcast completion
      await this.completionChannel.broadcast({
        type: 'task-completion',
        taskId,
        result,
        completedBy: completedBy || this.nodeId,
        timestamp: Date.now()
      });
      
      logger.info(`Task ${taskId} finalized as completed`);
      
      return {
        success: true,
        taskId,
        status: 'completed',
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Error finalizing task ${taskId}: ${error.message}`);
      
      return {
        success: false,
        taskId,
        error: error.message
      };
    }
  }
  
  /**
   * Get the status of a task
   * 
   * @param {string} taskId - ID of the task
   * @returns {Object} Task status
   */
  async getTaskStatus(taskId) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    // First check local knowledge
    if (this.activeTasks.has(taskId)) {
      const taskInfo = this.activeTasks.get(taskId);
      
      return {
        taskId,
        status: taskInfo.status,
        task: taskInfo.task,
        assignedAt: taskInfo.assignedAt,
        assignedTo: this.nodeId
      };
    } else if (this.completedTasks.has(taskId)) {
      const completedTask = this.completedTasks.get(taskId);
      
      return {
        taskId,
        status: 'completed',
        task: completedTask.task,
        result: completedTask.result,
        completedAt: completedTask.completedAt,
        completedBy: completedTask.completedBy
      };
    } else if (this.pendingTasks.has(taskId)) {
      const pendingTask = this.pendingTasks.get(taskId);
      
      return {
        taskId,
        status: 'pending',
        task: pendingTask.task,
        dependencies: pendingTask.dependencies,
        dependenciesStatus: await this.getDependencyStatus(pendingTask.dependencies)
      };
    }
    
    // We don't know locally, query the network
    try {
      const response = await this.statusService.request({
        type: 'task-status',
        taskId
      }, { timeout: 5000 });
      
      return response;
    } catch (error) {
      logger.error(`Error querying status for task ${taskId}: ${error.message}`);
      
      return {
        taskId,
        status: 'unknown',
        error: error.message
      };
    }
  }
  
  /**
   * Create a sequential workflow
   * 
   * @param {string} workflowId - ID for the workflow
   * @param {Array} tasks - Array of tasks to execute sequentially
   * @returns {Object} Workflow handle
   */
  createSequentialWorkflow(workflowId, tasks) {
    // Generate task IDs for each task
    const taskIds = tasks.map((task, index) => 
      `${workflowId}-task-${index}`
    );
    
    // Create dependencies (each task depends on the previous one)
    const dependencies = [];
    
    for (let i = 1; i < taskIds.length; i++) {
      dependencies.push({
        taskId: taskIds[i],
        dependsOn: [taskIds[i - 1]]
      });
    }
    
    // Return a workflow handle
    return {
      workflowId,
      taskIds,
      taskCount: tasks.length,
      type: 'sequential',
      
      /**
       * Start the workflow
       */
      start: async () => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        logger.info(`Starting sequential workflow ${workflowId} with ${tasks.length} tasks`);
        
        // Set up dependencies
        for (const dep of dependencies) {
          await this.setTaskDependencies(dep.taskId, dep.dependsOn);
        }
        
        // Only assign the first task
        await this.assignTask(taskIds[0], tasks[0]);
        
        // Assign other tasks but mark them as pending due to dependencies
        for (let i = 1; i < tasks.length; i++) {
          this.pendingTasks.set(taskIds[i], {
            task: tasks[i],
            dependencies: [taskIds[i - 1]],
            timestamp: Date.now()
          });
        }
        
        return {
          success: true,
          workflowId,
          startedTaskId: taskIds[0]
        };
      },
      
      /**
       * Get workflow status
       */
      getStatus: async () => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        const taskStatuses = {};
        
        for (const taskId of taskIds) {
          taskStatuses[taskId] = await this.getTaskStatus(taskId);
        }
        
        const completedCount = Object.values(taskStatuses)
          .filter(status => status.status === 'completed')
          .length;
        
        const isCompleted = completedCount === tasks.length;
        
        return {
          workflowId,
          taskStatuses,
          completedCount,
          totalTasks: tasks.length,
          progress: Math.round((completedCount / tasks.length) * 100),
          isCompleted
        };
      },
      
      /**
       * Cancel the workflow
       */
      cancel: async () => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        logger.info(`Cancelling sequential workflow ${workflowId}`);
        
        // Remove all pending tasks
        for (const taskId of taskIds) {
          this.pendingTasks.delete(taskId);
        }
        
        // Cancel all active tasks
        for (const taskId of taskIds) {
          if (this.activeTasks.has(taskId)) {
            await this.reassignTask(taskId, this.activeTasks.get(taskId).task, 'workflow-cancelled');
          }
        }
        
        return {
          success: true,
          workflowId,
          message: 'Workflow cancelled'
        };
      }
    };
  }
  
  /**
   * Create a concurrent workflow
   * 
   * @param {string} workflowId - ID for the workflow
   * @param {Array} tasks - Array of tasks to execute concurrently
   * @returns {Object} Workflow handle
   */
  createConcurrentWorkflow(workflowId, tasks) {
    // Generate task IDs for each task
    const taskIds = tasks.map((task, index) => 
      `${workflowId}-task-${index}`
    );
    
    // Return a workflow handle
    return {
      workflowId,
      taskIds,
      taskCount: tasks.length,
      type: 'concurrent',
      
      /**
       * Start the workflow
       */
      start: async () => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        logger.info(`Starting concurrent workflow ${workflowId} with ${tasks.length} tasks`);
        
        // Assign all tasks at once
        const assignments = [];
        
        for (let i = 0; i < tasks.length; i++) {
          assignments.push(this.assignTask(taskIds[i], tasks[i]));
        }
        
        await Promise.all(assignments);
        
        return {
          success: true,
          workflowId,
          assignedTasks: taskIds
        };
      },
      
      /**
       * Get workflow status
       */
      getStatus: async () => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        const taskStatuses = {};
        
        for (const taskId of taskIds) {
          taskStatuses[taskId] = await this.getTaskStatus(taskId);
        }
        
        const completedCount = Object.values(taskStatuses)
          .filter(status => status.status === 'completed')
          .length;
        
        const isCompleted = completedCount === tasks.length;
        
        return {
          workflowId,
          taskStatuses,
          completedCount,
          totalTasks: tasks.length,
          progress: Math.round((completedCount / tasks.length) * 100),
          isCompleted
        };
      },
      
      /**
       * Cancel the workflow
       */
      cancel: async () => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        logger.info(`Cancelling concurrent workflow ${workflowId}`);
        
        // Cancel all active tasks
        for (const taskId of taskIds) {
          if (this.activeTasks.has(taskId)) {
            await this.reassignTask(taskId, this.activeTasks.get(taskId).task, 'workflow-cancelled');
          }
        }
        
        return {
          success: true,
          workflowId,
          message: 'Workflow cancelled'
        };
      }
    };
  }
  
  /**
   * Create a dependency-based workflow
   * 
   * @param {string} workflowId - ID for the workflow
   * @param {Array} tasks - Array of tasks with dependencies
   * @returns {Object} Workflow handle
   */
  createDependencyWorkflow(workflowId, tasks) {
    // Each task should have { task, id, dependencies }
    const taskMap = new Map();
    
    for (const taskInfo of tasks) {
      const taskId = taskInfo.id || `${workflowId}-task-${taskMap.size}`;
      
      taskMap.set(taskId, {
        task: taskInfo.task,
        dependencies: taskInfo.dependencies || []
      });
    }
    
    // Return a workflow handle
    return {
      workflowId,
      taskIds: Array.from(taskMap.keys()),
      taskCount: taskMap.size,
      type: 'dependency',
      
      /**
       * Start the workflow
       */
      start: async () => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        logger.info(`Starting dependency workflow ${workflowId} with ${taskMap.size} tasks`);
        
        // Set up all dependencies
        for (const [taskId, info] of taskMap.entries()) {
          await this.setTaskDependencies(taskId, info.dependencies);
        }
        
        // Find tasks with no dependencies (roots)
        const rootTasks = Array.from(taskMap.entries())
          .filter(([_, info]) => info.dependencies.length === 0)
          .map(([taskId, info]) => ({ taskId, task: info.task }));
        
        // Assign root tasks
        const assignments = [];
        
        for (const { taskId, task } of rootTasks) {
          assignments.push(this.assignTask(taskId, task));
        }
        
        await Promise.all(assignments);
        
        // Add dependent tasks as pending
        for (const [taskId, info] of taskMap.entries()) {
          if (info.dependencies.length > 0) {
            this.pendingTasks.set(taskId, {
              task: info.task,
              dependencies: info.dependencies,
              timestamp: Date.now()
            });
          }
        }
        
        return {
          success: true,
          workflowId,
          assignedTasks: rootTasks.map(t => t.taskId)
        };
      },
      
      /**
       * Get workflow status
       */
      getStatus: async () => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        const taskStatuses = {};
        
        for (const taskId of taskMap.keys()) {
          taskStatuses[taskId] = await this.getTaskStatus(taskId);
        }
        
        const completedCount = Object.values(taskStatuses)
          .filter(status => status.status === 'completed')
          .length;
        
        const isCompleted = completedCount === taskMap.size;
        
        return {
          workflowId,
          taskStatuses,
          completedCount,
          totalTasks: taskMap.size,
          progress: Math.round((completedCount / taskMap.size) * 100),
          isCompleted
        };
      },
      
      /**
       * Cancel the workflow
       */
      cancel: async () => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        logger.info(`Cancelling dependency workflow ${workflowId}`);
        
        // Remove all pending tasks
        for (const taskId of taskMap.keys()) {
          this.pendingTasks.delete(taskId);
        }
        
        // Cancel all active tasks
        for (const taskId of taskMap.keys()) {
          if (this.activeTasks.has(taskId)) {
            await this.reassignTask(taskId, this.activeTasks.get(taskId).task, 'workflow-cancelled');
          }
        }
        
        return {
          success: true,
          workflowId,
          message: 'Workflow cancelled'
        };
      }
    };
  }
  
  /**
   * Check if a node is available for task assignment
   * 
   * @param {string} nodeId - ID of the node to check
   * @returns {Object} Availability result
   */
  async checkNodeAvailability(nodeId) {
    try {
      const response = await this.statusService.request({
        type: 'node-status',
        nodeId
      }, { timeout: 5000 });
      
      const isAvailable = response.load < response.maxLoad;
      
      return {
        nodeId,
        available: isAvailable,
        load: response.load,
        maxLoad: response.maxLoad,
        activeTasks: response.activeTasks
      };
    } catch (error) {
      logger.error(`Error checking availability for node ${nodeId}: ${error.message}`);
      
      return {
        nodeId,
        available: false,
        error: error.message
      };
    }
  }
  
  /**
   * Create a quality gate
   * 
   * @param {string} gateId - ID for the quality gate
   * @param {Object} config - Gate configuration
   * @returns {Object} Quality gate handle
   */
  createQualityGate(gateId, config) {
    if (!this.config.qualityGatesEnabled) {
      logger.warn('Quality gates are disabled in the configuration');
    }
    
    return {
      gateId,
      config,
      
      /**
       * Process an item through the quality gate
       */
      process: async (item, metadata = {}) => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        logger.info(`Processing item through quality gate ${gateId}`);
        
        // Create a review task
        const taskId = `gate-${gateId}-${Date.now()}`;
        const task = {
          type: 'quality-gate',
          gateId,
          item,
          metadata,
          config,
          submittedBy: this.nodeId,
          submittedAt: Date.now()
        };
        
        // Assign to an appropriate reviewer
        const targetReviewer = config.reviewer || 'any-except:' + this.nodeId;
        await this.assignTask(taskId, task, targetReviewer);
        
        return {
          success: true,
          taskId,
          gateId,
          timestamp: Date.now()
        };
      },
      
      /**
       * Check the status of a quality gate task
       */
      checkStatus: async (taskId) => {
        return await this.getTaskStatus(taskId);
      }
    };
  }
  
  /**
   * Create a conflict resolution channel
   * 
   * @param {string} channelId - ID for the channel
   * @param {Object} config - Conflict resolution configuration
   * @returns {Object} Conflict resolution handle
   */
  createConflictResolutionChannel(channelId, config = {}) {
    const resolveStrategy = config.strategy || this.config.conflictResolution;
    
    return {
      channelId,
      
      /**
       * Submit a solution to a conflict
       */
      submitSolution: async (conflictId, solution, metadata = {}) => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        // Store in shared state
        await this.sharedState.append(['conflicts', channelId, conflictId, 'solutions'], {
          solution,
          nodeId: this.nodeId,
          timestamp: Date.now(),
          metadata
        });
        
        // Get current solutions
        const solutions = await this.sharedState.get(['conflicts', channelId, conflictId, 'solutions']) || [];
        
        logger.info(`Submitted solution for conflict ${conflictId} in channel ${channelId} (${solutions.length} total)`);
        
        return {
          success: true,
          conflictId,
          channelId,
          solutionCount: solutions.length
        };
      },
      
      /**
       * Resolve a conflict
       */
      resolveConflict: async (conflictId) => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        // Get all solutions
        const solutions = await this.sharedState.get(['conflicts', channelId, conflictId, 'solutions']) || [];
        
        if (solutions.length === 0) {
          return {
            success: false,
            conflictId,
            channelId,
            error: 'No solutions available'
          };
        }
        
        // Apply resolution strategy
        let resolvedSolution = null;
        
        if (resolveStrategy === 'majority-vote' && solutions.length > 1) {
          // Group identical solutions and count them
          const solutionCounts = new Map();
          
          for (const { solution } of solutions) {
            const key = JSON.stringify(solution);
            solutionCounts.set(key, (solutionCounts.get(key) || 0) + 1);
          }
          
          // Find the most common solution
          let maxCount = 0;
          let maxSolution = null;
          
          for (const [key, count] of solutionCounts.entries()) {
            if (count > maxCount) {
              maxCount = count;
              maxSolution = JSON.parse(key);
            }
          }
          
          resolvedSolution = {
            solution: maxSolution,
            votes: maxCount,
            totalVotes: solutions.length,
            strategy: 'majority-vote'
          };
        } else if (resolveStrategy === 'first-submitted') {
          // Take the first submitted solution
          const firstSolution = solutions.sort((a, b) => a.timestamp - b.timestamp)[0];
          
          resolvedSolution = {
            solution: firstSolution.solution,
            submittedBy: firstSolution.nodeId,
            timestamp: firstSolution.timestamp,
            strategy: 'first-submitted'
          };
        } else if (resolveStrategy === 'last-submitted') {
          // Take the last submitted solution
          const lastSolution = solutions.sort((a, b) => b.timestamp - a.timestamp)[0];
          
          resolvedSolution = {
            solution: lastSolution.solution,
            submittedBy: lastSolution.nodeId,
            timestamp: lastSolution.timestamp,
            strategy: 'last-submitted'
          };
        }
        
        // Store the resolution
        await this.sharedState.set(['conflicts', channelId, conflictId, 'resolution'], {
          ...resolvedSolution,
          resolvedAt: Date.now(),
          resolvedBy: this.nodeId
        });
        
        logger.info(`Resolved conflict ${conflictId} in channel ${channelId} using ${resolveStrategy} strategy`);
        
        return {
          success: true,
          conflictId,
          channelId,
          resolution: resolvedSolution
        };
      },
      
      /**
       * Get the resolution status
       */
      getResolutionStatus: async (conflictId) => {
        if (!this.isInitialized) {
          await this.initialize();
        }
        
        // Get solutions and resolution
        const solutions = await this.sharedState.get(['conflicts', channelId, conflictId, 'solutions']) || [];
        const resolution = await this.sharedState.get(['conflicts', channelId, conflictId, 'resolution']);
        
        return {
          conflictId,
          channelId,
          solutionCount: solutions.length,
          isResolved: !!resolution,
          resolution
        };
      }
    };
  }
  
  /**
   * Get coordination statistics and metrics
   * 
   * @returns {Object} Coordination metrics
   */
  getMetrics() {
    return {
      nodeId: this.nodeId,
      initialized: this.isInitialized,
      activeTasks: this.activeTasks.size,
      pendingTasks: this.pendingTasks.size,
      completedTasks: this.completedTasks.size,
      taskReviews: this.taskReviewers.size,
      timestamp: Date.now()
    };
  }
  
  /**
   * Disconnect and clean up
   */
  async shutdown() {
    try {
      logger.info('Shutting down Coordination module');
      
      // Clear all timeouts
      for (const timeout of this.taskTimeouts.values()) {
        clearTimeout(timeout);
      }
      this.taskTimeouts.clear();
      
      // Unsubscribe from channels
      if (this.assignmentChannel) {
        await this.assignmentChannel.subscribe(this.nodeId).unsubscribe();
      }
      
      if (this.completionChannel) {
        await this.completionChannel.subscribe(this.nodeId).unsubscribe();
      }
      
      if (this.statusService) {
        await this.statusService.close();
      }
      
      // Shutdown dependencies
      await this.sharedState.shutdown();
      await this.messageQueue.disconnect();
      
      logger.info('Coordination module shut down');
      
      return true;
    } catch (error) {
      logger.error(`Error shutting down Coordination module: ${error.message}`);
      throw error;
    }
  }
}

module.exports = Coordination;
