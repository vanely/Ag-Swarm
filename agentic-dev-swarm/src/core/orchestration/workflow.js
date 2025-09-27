/**
 * Workflow orchestration module for the Agentic Software Development Swarm
 * 
 * This module provides patterns for sequential, concurrent, and hierarchical agent coordination.
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');
const StateManager = require('./state-manager');
const TaskRouter = require('./task-router');
const ErrorHandler = require('./error-handler');

class Workflow extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.stateManager = new StateManager(config.stateManager || {});
    this.taskRouter = new TaskRouter(config.taskRouter || {});
    this.errorHandler = new ErrorHandler(config.errorHandler || {});
    this.activeWorkflows = new Map();
    this.workflowTemplates = {
      sequential: this.createSequentialWorkflow.bind(this),
      concurrent: this.createConcurrentWorkflow.bind(this),
      hierarchical: this.createHierarchicalWorkflow.bind(this),
    };

    logger.info('Workflow orchestration system initialized');
  }

  /**
   * Creates and initializes a new workflow
   * 
   * @param {string} workflowId - Unique identifier for the workflow
   * @param {string} workflowType - Type of workflow (sequential, concurrent, hierarchical)
   * @param {Object} workflowConfig - Configuration for the workflow
   * @returns {Object} The created workflow instance
   */
  createWorkflow(workflowId, workflowType, workflowConfig) {
    if (this.activeWorkflows.has(workflowId)) {
      throw new Error(`Workflow with ID ${workflowId} already exists`);
    }

    if (!this.workflowTemplates[workflowType]) {
      throw new Error(`Unknown workflow type: ${workflowType}`);
    }

    const workflow = this.workflowTemplates[workflowType](workflowId, workflowConfig);
    this.activeWorkflows.set(workflowId, workflow);

    logger.info(`Created ${workflowType} workflow with ID ${workflowId}`);
    this.emit('workflow:created', { workflowId, workflowType });

    return workflow;
  }

  /**
   * Creates a sequential workflow where tasks execute one after another
   * 
   * @param {string} workflowId - Unique identifier for the workflow
   * @param {Object} workflowConfig - Configuration for the workflow
   * @returns {Object} The created sequential workflow
   */
  createSequentialWorkflow(workflowId, workflowConfig) {
    const { tasks = [] } = workflowConfig;
    
    const workflow = {
      id: workflowId,
      type: 'sequential',
      config: workflowConfig,
      state: {
        status: 'created',
        currentTaskIndex: -1,
        results: [],
        errors: [],
        startTime: null,
        endTime: null,
      },
      tasks: tasks.map(task => ({ ...task, status: 'pending' })),
    };

    this.stateManager.initializeWorkflowState(workflowId, workflow.state);
    
    return {
      ...workflow,
      start: async () => this.startSequentialWorkflow(workflow),
      pause: () => this.pauseWorkflow(workflow),
      resume: () => this.resumeWorkflow(workflow),
      cancel: () => this.cancelWorkflow(workflow),
      addTask: (task) => this.addTaskToWorkflow(workflow, task),
      getStatus: () => this.getWorkflowStatus(workflow),
    };
  }

  /**
   * Creates a concurrent workflow where tasks can execute in parallel
   * 
   * @param {string} workflowId - Unique identifier for the workflow
   * @param {Object} workflowConfig - Configuration for the workflow
   * @returns {Object} The created concurrent workflow
   */
  createConcurrentWorkflow(workflowId, workflowConfig) {
    const { tasks = [], maxConcurrent = 5 } = workflowConfig;
    
    const workflow = {
      id: workflowId,
      type: 'concurrent',
      config: workflowConfig,
      state: {
        status: 'created',
        activeTasks: 0,
        maxConcurrent,
        results: {},
        errors: {},
        startTime: null,
        endTime: null,
      },
      tasks: tasks.map(task => ({ ...task, status: 'pending' })),
    };

    this.stateManager.initializeWorkflowState(workflowId, workflow.state);
    
    return {
      ...workflow,
      start: async () => this.startConcurrentWorkflow(workflow),
      pause: () => this.pauseWorkflow(workflow),
      resume: () => this.resumeWorkflow(workflow),
      cancel: () => this.cancelWorkflow(workflow),
      addTask: (task) => this.addTaskToWorkflow(workflow, task),
      getStatus: () => this.getWorkflowStatus(workflow),
    };
  }

  /**
   * Creates a hierarchical workflow where tasks are organized in a tree structure
   * 
   * @param {string} workflowId - Unique identifier for the workflow
   * @param {Object} workflowConfig - Configuration for the workflow
   * @returns {Object} The created hierarchical workflow
   */
  createHierarchicalWorkflow(workflowId, workflowConfig) {
    const { rootTask, maxDepth = 5 } = workflowConfig;
    
    if (!rootTask) {
      throw new Error('Hierarchical workflow requires a rootTask');
    }

    const workflow = {
      id: workflowId,
      type: 'hierarchical',
      config: workflowConfig,
      state: {
        status: 'created',
        activeNodes: 0,
        maxDepth,
        results: {},
        errors: {},
        startTime: null,
        endTime: null,
      },
      rootTask: { ...rootTask, status: 'pending', children: rootTask.children || [] },
    };

    this.stateManager.initializeWorkflowState(workflowId, workflow.state);
    
    return {
      ...workflow,
      start: async () => this.startHierarchicalWorkflow(workflow),
      pause: () => this.pauseWorkflow(workflow),
      resume: () => this.resumeWorkflow(workflow),
      cancel: () => this.cancelWorkflow(workflow),
      addTask: (parentTaskId, task) => this.addTaskToHierarchy(workflow, parentTaskId, task),
      getStatus: () => this.getWorkflowStatus(workflow),
    };
  }

  /**
   * Starts execution of a sequential workflow
   * 
   * @param {Object} workflow - The workflow to start
   */
  async startSequentialWorkflow(workflow) {
    if (workflow.state.status === 'running') {
      logger.warn(`Workflow ${workflow.id} is already running`);
      return;
    }

    try {
      workflow.state.status = 'running';
      workflow.state.startTime = Date.now();
      this.stateManager.updateWorkflowState(workflow.id, workflow.state);
      this.emit('workflow:started', { workflowId: workflow.id, type: workflow.type });
      
      logger.info(`Starting sequential workflow ${workflow.id}`);
      
      for (let i = 0; i < workflow.tasks.length; i++) {
        if (workflow.state.status !== 'running') {
          // Workflow was paused or canceled
          break;
        }
        
        workflow.state.currentTaskIndex = i;
        const currentTask = workflow.tasks[i];
        currentTask.status = 'running';
        
        this.stateManager.updateWorkflowState(workflow.id, workflow.state);
        this.emit('task:started', { 
          workflowId: workflow.id, 
          taskId: currentTask.id,
          taskIndex: i 
        });
        
        try {
          logger.info(`Executing task ${currentTask.id} in workflow ${workflow.id}`);
          const taskResult = await this.taskRouter.routeTask(currentTask);
          
          currentTask.status = 'completed';
          workflow.state.results[i] = taskResult;
          
          this.emit('task:completed', { 
            workflowId: workflow.id, 
            taskId: currentTask.id,
            taskIndex: i,
            result: taskResult 
          });
        } catch (error) {
          currentTask.status = 'failed';
          workflow.state.errors[i] = error.message;
          
          this.emit('task:failed', { 
            workflowId: workflow.id, 
            taskId: currentTask.id,
            taskIndex: i,
            error 
          });
          
          const errorHandling = await this.errorHandler.handleError(workflow, i, error);
          if (errorHandling.action === 'retry') {
            // Retry the current task
            i--;
            continue;
          } else if (errorHandling.action === 'skip') {
            // Skip to the next task
            continue;
          } else if (errorHandling.action === 'abort') {
            // Abort the workflow
            workflow.state.status = 'failed';
            workflow.state.endTime = Date.now();
            this.stateManager.updateWorkflowState(workflow.id, workflow.state);
            this.emit('workflow:failed', { 
              workflowId: workflow.id,
              error
            });
            return;
          }
        }
        
        this.stateManager.updateWorkflowState(workflow.id, workflow.state);
      }
      
      if (workflow.state.status === 'running') {
        workflow.state.status = 'completed';
        workflow.state.endTime = Date.now();
        this.stateManager.updateWorkflowState(workflow.id, workflow.state);
        this.emit('workflow:completed', { workflowId: workflow.id });
        logger.info(`Sequential workflow ${workflow.id} completed successfully`);
      }
    } catch (error) {
      logger.error(`Error in workflow ${workflow.id}: ${error.message}`);
      workflow.state.status = 'failed';
      workflow.state.endTime = Date.now();
      this.stateManager.updateWorkflowState(workflow.id, workflow.state);
      this.emit('workflow:failed', { workflowId: workflow.id, error });
    }
  }

  /**
   * Starts execution of a concurrent workflow
   * 
   * @param {Object} workflow - The workflow to start
   */
  async startConcurrentWorkflow(workflow) {
    if (workflow.state.status === 'running') {
      logger.warn(`Workflow ${workflow.id} is already running`);
      return;
    }

    try {
      workflow.state.status = 'running';
      workflow.state.startTime = Date.now();
      workflow.state.activeTasks = 0;
      this.stateManager.updateWorkflowState(workflow.id, workflow.state);
      this.emit('workflow:started', { workflowId: workflow.id, type: workflow.type });
      
      logger.info(`Starting concurrent workflow ${workflow.id}`);
      
      // Create a queue of pending tasks
      const pendingTasks = [...workflow.tasks];
      const runningTasks = new Map();
      const completedTaskCount = 0;
      
      // Start initial batch of tasks up to maxConcurrent
      this.scheduleConcurrentTasks(workflow, pendingTasks, runningTasks, completedTaskCount);
      
      // Wait for all tasks to complete
      while (pendingTasks.length > 0 || runningTasks.size > 0) {
        if (workflow.state.status !== 'running') {
          // Workflow was paused or canceled
          break;
        }
        
        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (workflow.state.status === 'running') {
        workflow.state.status = 'completed';
        workflow.state.endTime = Date.now();
        this.stateManager.updateWorkflowState(workflow.id, workflow.state);
        this.emit('workflow:completed', { workflowId: workflow.id });
        logger.info(`Concurrent workflow ${workflow.id} completed successfully`);
      }
    } catch (error) {
      logger.error(`Error in workflow ${workflow.id}: ${error.message}`);
      workflow.state.status = 'failed';
      workflow.state.endTime = Date.now();
      this.stateManager.updateWorkflowState(workflow.id, workflow.state);
      this.emit('workflow:failed', { workflowId: workflow.id, error });
    }
  }

  /**
   * Schedule concurrent tasks up to the maximum allowed
   * 
   * @param {Object} workflow - The workflow
   * @param {Array} pendingTasks - Queue of pending tasks
   * @param {Map} runningTasks - Map of currently running tasks
   * @param {number} completedTaskCount - Number of tasks completed
   */
  scheduleConcurrentTasks(workflow, pendingTasks, runningTasks, completedTaskCount) {
    while (
      pendingTasks.length > 0 && 
      runningTasks.size < workflow.state.maxConcurrent &&
      workflow.state.status === 'running'
    ) {
      const task = pendingTasks.shift();
      task.status = 'running';
      
      const taskPromise = (async () => {
        try {
          this.emit('task:started', { workflowId: workflow.id, taskId: task.id });
          logger.info(`Executing task ${task.id} in workflow ${workflow.id}`);
          
          const result = await this.taskRouter.routeTask(task);
          
          if (workflow.state.status === 'running') {
            task.status = 'completed';
            workflow.state.results[task.id] = result;
            this.emit('task:completed', { 
              workflowId: workflow.id, 
              taskId: task.id,
              result 
            });
          }
          
          return { success: true, task, result };
        } catch (error) {
          task.status = 'failed';
          workflow.state.errors[task.id] = error.message;
          this.emit('task:failed', { 
            workflowId: workflow.id, 
            taskId: task.id,
            error 
          });
          
          const errorHandling = await this.errorHandler.handleError(workflow, task.id, error);
          
          if (errorHandling.action === 'retry') {
            // Add the task back to the pending queue
            pendingTasks.unshift({ ...task, status: 'pending' });
          } else if (errorHandling.action === 'abort') {
            // Abort the entire workflow
            workflow.state.status = 'failed';
            workflow.state.endTime = Date.now();
            this.stateManager.updateWorkflowState(workflow.id, workflow.state);
            this.emit('workflow:failed', { workflowId: workflow.id, error });
          }
          
          return { success: false, task, error };
        } finally {
          runningTasks.delete(task.id);
          workflow.state.activeTasks--;
          completedTaskCount++;
          
          this.stateManager.updateWorkflowState(workflow.id, workflow.state);
          
          // Schedule more tasks if available
          if (workflow.state.status === 'running') {
            this.scheduleConcurrentTasks(workflow, pendingTasks, runningTasks, completedTaskCount);
          }
        }
      })();
      
      runningTasks.set(task.id, taskPromise);
      workflow.state.activeTasks++;
      this.stateManager.updateWorkflowState(workflow.id, workflow.state);
    }
  }

  /**
   * Starts execution of a hierarchical workflow
   * 
   * @param {Object} workflow - The workflow to start
   */
  async startHierarchicalWorkflow(workflow) {
    if (workflow.state.status === 'running') {
      logger.warn(`Workflow ${workflow.id} is already running`);
      return;
    }

    try {
      workflow.state.status = 'running';
      workflow.state.startTime = Date.now();
      workflow.state.activeNodes = 0;
      this.stateManager.updateWorkflowState(workflow.id, workflow.state);
      this.emit('workflow:started', { workflowId: workflow.id, type: workflow.type });
      
      logger.info(`Starting hierarchical workflow ${workflow.id}`);
      
      // Start with the root task
      await this.executeHierarchicalTask(workflow, workflow.rootTask, 0);
      
      if (workflow.state.status === 'running') {
        workflow.state.status = 'completed';
        workflow.state.endTime = Date.now();
        this.stateManager.updateWorkflowState(workflow.id, workflow.state);
        this.emit('workflow:completed', { workflowId: workflow.id });
        logger.info(`Hierarchical workflow ${workflow.id} completed successfully`);
      }
    } catch (error) {
      logger.error(`Error in workflow ${workflow.id}: ${error.message}`);
      workflow.state.status = 'failed';
      workflow.state.endTime = Date.now();
      this.stateManager.updateWorkflowState(workflow.id, workflow.state);
      this.emit('workflow:failed', { workflowId: workflow.id, error });
    }
  }

  /**
   * Execute a task in a hierarchical workflow
   * 
   * @param {Object} workflow - The workflow
   * @param {Object} task - The task to execute
   * @param {number} depth - Current depth in the hierarchy
   */
  async executeHierarchicalTask(workflow, task, depth) {
    if (workflow.state.status !== 'running' || depth > workflow.state.maxDepth) {
      return;
    }
    
    try {
      task.status = 'running';
      workflow.state.activeNodes++;
      this.stateManager.updateWorkflowState(workflow.id, workflow.state);
      
      this.emit('task:started', { 
        workflowId: workflow.id, 
        taskId: task.id,
        depth 
      });
      
      logger.info(`Executing task ${task.id} at depth ${depth} in workflow ${workflow.id}`);
      const result = await this.taskRouter.routeTask(task);
      
      task.status = 'completed';
      workflow.state.results[task.id] = result;
      workflow.state.activeNodes--;
      
      this.emit('task:completed', { 
        workflowId: workflow.id, 
        taskId: task.id,
        depth,
        result 
      });
      
      // Process child tasks if any
      if (Array.isArray(task.children) && task.children.length > 0) {
        const nextDepth = depth + 1;
        
        // Process child tasks concurrently if not too deep
        if (nextDepth < 3) {
          await Promise.all(
            task.children.map(childTask => 
              this.executeHierarchicalTask(workflow, childTask, nextDepth)
            )
          );
        } else {
          // Process deeper tasks sequentially to avoid overwhelming the system
          for (const childTask of task.children) {
            await this.executeHierarchicalTask(workflow, childTask, nextDepth);
          }
        }
      }
      
      this.stateManager.updateWorkflowState(workflow.id, workflow.state);
    } catch (error) {
      task.status = 'failed';
      workflow.state.errors[task.id] = error.message;
      workflow.state.activeNodes--;
      
      this.emit('task:failed', { 
        workflowId: workflow.id, 
        taskId: task.id,
        depth,
        error 
      });
      
      const errorHandling = await this.errorHandler.handleError(workflow, task.id, error);
      
      if (errorHandling.action === 'retry') {
        // Retry the task
        task.status = 'pending';
        return this.executeHierarchicalTask(workflow, task, depth);
      } else if (errorHandling.action === 'abort') {
        // Abort the entire workflow
        workflow.state.status = 'failed';
        workflow.state.endTime = Date.now();
        this.stateManager.updateWorkflowState(workflow.id, workflow.state);
        this.emit('workflow:failed', { workflowId: workflow.id, error });
      }
      // If action is 'skip', we just don't process the children
      
      this.stateManager.updateWorkflowState(workflow.id, workflow.state);
    }
  }

  /**
   * Pauses an active workflow
   * 
   * @param {Object} workflow - The workflow to pause
   */
  pauseWorkflow(workflow) {
    if (workflow.state.status !== 'running') {
      logger.warn(`Cannot pause workflow ${workflow.id}: not running`);
      return false;
    }

    workflow.state.status = 'paused';
    this.stateManager.updateWorkflowState(workflow.id, workflow.state);
    this.emit('workflow:paused', { workflowId: workflow.id });
    logger.info(`Workflow ${workflow.id} paused`);
    
    return true;
  }

  /**
   * Resumes a paused workflow
   * 
   * @param {Object} workflow - The workflow to resume
   */
  resumeWorkflow(workflow) {
    if (workflow.state.status !== 'paused') {
      logger.warn(`Cannot resume workflow ${workflow.id}: not paused`);
      return false;
    }

    workflow.state.status = 'running';
    this.stateManager.updateWorkflowState(workflow.id, workflow.state);
    this.emit('workflow:resumed', { workflowId: workflow.id });
    logger.info(`Workflow ${workflow.id} resumed`);
    
    // Resume execution based on workflow type
    if (workflow.type === 'sequential') {
      this.startSequentialWorkflow(workflow);
    } else if (workflow.type === 'concurrent') {
      this.startConcurrentWorkflow(workflow);
    } else if (workflow.type === 'hierarchical') {
      this.startHierarchicalWorkflow(workflow);
    }
    
    return true;
  }

  /**
   * Cancels an active workflow
   * 
   * @param {Object} workflow - The workflow to cancel
   */
  cancelWorkflow(workflow) {
    if (['completed', 'failed', 'canceled'].includes(workflow.state.status)) {
      logger.warn(`Cannot cancel workflow ${workflow.id}: already finished`);
      return false;
    }

    workflow.state.status = 'canceled';
    workflow.state.endTime = Date.now();
    this.stateManager.updateWorkflowState(workflow.id, workflow.state);
    this.emit('workflow:canceled', { workflowId: workflow.id });
    logger.info(`Workflow ${workflow.id} canceled`);
    
    return true;
  }

  /**
   * Adds a task to a sequential or concurrent workflow
   * 
   * @param {Object} workflow - The workflow to add a task to
   * @param {Object} task - The task to add
   */
  addTaskToWorkflow(workflow, task) {
    if (!['sequential', 'concurrent'].includes(workflow.type)) {
      throw new Error(`Cannot add task directly to workflow of type ${workflow.type}`);
    }

    if (!task.id) {
      task.id = `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    }

    task.status = 'pending';
    workflow.tasks.push(task);
    
    this.emit('task:added', { workflowId: workflow.id, taskId: task.id });
    logger.info(`Task ${task.id} added to workflow ${workflow.id}`);
    
    return task;
  }

  /**
   * Adds a task to a hierarchical workflow
   * 
   * @param {Object} workflow - The workflow to add a task to
   * @param {string} parentTaskId - ID of the parent task
   * @param {Object} task - The task to add
   */
  addTaskToHierarchy(workflow, parentTaskId, task) {
    if (workflow.type !== 'hierarchical') {
      throw new Error('This method is only for hierarchical workflows');
    }

    if (!task.id) {
      task.id = `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    }

    task.status = 'pending';
    
    // Find the parent task using a recursive search
    const findAndAddChild = (node) => {
      if (node.id === parentTaskId) {
        if (!Array.isArray(node.children)) {
          node.children = [];
        }
        node.children.push(task);
        return true;
      }
      
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if (findAndAddChild(child)) {
            return true;
          }
        }
      }
      
      return false;
    };

    if (!findAndAddChild(workflow.rootTask)) {
      throw new Error(`Parent task with ID ${parentTaskId} not found`);
    }
    
    this.emit('task:added', { 
      workflowId: workflow.id, 
      taskId: task.id,
      parentTaskId 
    });
    
    logger.info(`Task ${task.id} added to parent ${parentTaskId} in workflow ${workflow.id}`);
    
    return task;
  }

  /**
   * Gets the current status of a workflow
   * 
   * @param {Object} workflow - The workflow
   * @returns {Object} The workflow status
   */
  getWorkflowStatus(workflow) {
    return {
      id: workflow.id,
      type: workflow.type,
      status: workflow.state.status,
      startTime: workflow.state.startTime,
      endTime: workflow.state.endTime,
      progress: this.calculateWorkflowProgress(workflow),
      taskSummary: this.getTaskSummary(workflow),
      errors: Object.keys(workflow.state.errors || {}).length > 0,
    };
  }

  /**
   * Calculates the current progress of a workflow
   * 
   * @param {Object} workflow - The workflow
   * @returns {number} Progress percentage (0-100)
   */
  calculateWorkflowProgress(workflow) {
    if (workflow.state.status === 'completed') {
      return 100;
    }
    
    if (workflow.state.status === 'created') {
      return 0;
    }
    
    if (workflow.type === 'sequential') {
      const totalTasks = workflow.tasks.length;
      if (totalTasks === 0) return 0;
      
      const completedTasks = workflow.tasks.filter(t => t.status === 'completed').length;
      return Math.round((completedTasks / totalTasks) * 100);
    }
    
    if (workflow.type === 'concurrent') {
      const totalTasks = workflow.tasks.length;
      if (totalTasks === 0) return 0;
      
      const completedTasks = workflow.tasks.filter(t => t.status === 'completed').length;
      return Math.round((completedTasks / totalTasks) * 100);
    }
    
    if (workflow.type === 'hierarchical') {
      // Count all tasks in the hierarchy
      const countTasks = (node) => {
        let count = 1; // Count the node itself
        if (Array.isArray(node.children)) {
          for (const child of node.children) {
            count += countTasks(child);
          }
        }
        return count;
      };
      
      // Count completed tasks
      const countCompletedTasks = (node) => {
        let count = node.status === 'completed' ? 1 : 0;
        if (Array.isArray(node.children)) {
          for (const child of node.children) {
            count += countCompletedTasks(child);
          }
        }
        return count;
      };
      
      const totalTasks = countTasks(workflow.rootTask);
      const completedTasks = countCompletedTasks(workflow.rootTask);
      
      return Math.round((completedTasks / totalTasks) * 100);
    }
    
    return 0;
  }

  /**
   * Gets a summary of task statuses in a workflow
   * 
   * @param {Object} workflow - The workflow
   * @returns {Object} Summary of task counts by status
   */
  getTaskSummary(workflow) {
    const summary = {
      total: 0,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0
    };
    
    if (workflow.type === 'sequential' || workflow.type === 'concurrent') {
      summary.total = workflow.tasks.length;
      
      for (const task of workflow.tasks) {
        summary[task.status]++;
      }
    } else if (workflow.type === 'hierarchical') {
      // Count tasks by status in the hierarchy
      const countTasksByStatus = (node) => {
        summary.total++;
        summary[node.status]++;
        
        if (Array.isArray(node.children)) {
          for (const child of node.children) {
            countTasksByStatus(child);
          }
        }
      };
      
      countTasksByStatus(workflow.rootTask);
    }
    
    return summary;
  }

  /**
   * Removes a completed or failed workflow
   * 
   * @param {string} workflowId - ID of the workflow to remove
   */
  removeWorkflow(workflowId) {
    const workflow = this.activeWorkflows.get(workflowId);
    
    if (!workflow) {
      logger.warn(`Cannot remove workflow ${workflowId}: not found`);
      return false;
    }
    
    if (['running', 'paused'].includes(workflow.state.status)) {
      logger.warn(`Cannot remove workflow ${workflowId}: still active`);
      return false;
    }
    
    this.activeWorkflows.delete(workflowId);
    this.stateManager.removeWorkflowState(workflowId);
    
    this.emit('workflow:removed', { workflowId });
    logger.info(`Workflow ${workflowId} removed`);
    
    return true;
  }

  /**
   * Gets all active workflows
   * 
   * @returns {Array} Array of workflow IDs and their statuses
   */
  getAllWorkflows() {
    return Array.from(this.activeWorkflows.entries()).map(([id, workflow]) => ({
      id,
      type: workflow.type,
      status: workflow.state.status,
    }));
  }
}

module.exports = Workflow;
