/**
 * Base Agent for the Agentic Software Development Swarm
 * 
 * This module provides a base class for all specialized agents.
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');
const SharedState = require('../core/communication/shared-state');
const MessageQueue = require('../core/communication/message-queue');
const KnowledgeBase = require('../core/memory/knowledge-base');

class BaseAgent extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      id: config.id || `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: config.name || 'Agent',
      type: config.type || 'base',
      capabilities: config.capabilities || [],
      specializations: config.specializations || [],
      model: config.model || 'gpt-5',
      fallbackModels: config.fallbackModels || ['claude-opus-4.1', 'grok-4'],
      contextLength: config.contextLength || 32000,
      maxConcurrentTasks: config.maxConcurrentTasks || 3,
      apiKeys: config.apiKeys || {},
      taskTimeout: config.taskTimeout || 300000, // 5 minutes
      useSharedState: config.useSharedState !== false,
      useMessageQueue: config.useMessageQueue !== false,
      useKnowledgeBase: config.useKnowledgeBase !== false,
      logTaskInputOutput: config.logTaskInputOutput !== false,
      retryEnabled: config.retryEnabled !== false,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 5000, // 5 seconds
      ...config
    };
    
    // Agent state
    this.status = 'initializing';
    this.isReady = false;
    this.activeTasks = new Map();
    this.taskHistory = [];
    this.taskTimeouts = new Map();
    this.modelMetrics = new Map();
    
    // Initialize dependencies if enabled
    if (this.config.useSharedState) {
      this.sharedState = new SharedState(config.sharedState || {});
    }
    
    if (this.config.useMessageQueue) {
      this.messageQueue = new MessageQueue(config.messageQueue || {});
    }
    
    if (this.config.useKnowledgeBase) {
      this.knowledgeBase = new KnowledgeBase(config.knowledgeBase || {});
    }
    
    // Model clients will be lazily initialized
    this.modelClients = new Map();
    
    logger.info(`Base Agent initialized: ${this.config.id} (${this.config.type})`);
    logger.debug(`Agent configuration: ${JSON.stringify({
      id: this.config.id,
      type: this.config.type,
      model: this.config.model,
      specializations: this.config.specializations
    })}`);
  }
  
  /**
   * Initialize the agent
   */
  async initialize() {
    try {
      this.status = 'initializing';
      
      // Initialize shared state if enabled
      if (this.config.useSharedState && this.sharedState) {
        await this.sharedState.initialize();
      }
      
      // Initialize message queue if enabled
      if (this.config.useMessageQueue && this.messageQueue) {
        await this.messageQueue.connect();
      }
      
      // Initialize knowledge base if enabled
      if (this.config.useKnowledgeBase && this.knowledgeBase) {
        await this.knowledgeBase.initialize();
      }
      
      // Initialize primary model client
      await this.initializeModelClient(this.config.model);
      
      // Set agent as ready
      this.isReady = true;
      this.status = 'idle';
      
      logger.info(`Agent ${this.config.id} initialized and ready`);
      this.emit('ready');
      
      return true;
    } catch (error) {
      this.status = 'error';
      logger.error(`Error initializing agent ${this.config.id}: ${error.message}`);
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Initialize a model client
   * 
   * @param {string} modelName - Name of the model
   * @returns {Object} Model client
   */
  async initializeModelClient(modelName) {
    // Check if already initialized
    if (this.modelClients.has(modelName)) {
      return this.modelClients.get(modelName);
    }
    
    try {
      // Determine provider from model name
      const provider = this.getProviderFromModel(modelName);
      
      // Initialize client based on provider
      let client;
      
      switch (provider) {
        case 'openai':
          const { default: OpenAIClient } = await import('../models/gpt-client');
          client = new OpenAIClient({
            apiKey: this.config.apiKeys.openai || process.env.OPENAI_API_KEY,
            model: modelName
          });
          break;
        
        case 'anthropic':
          const { default: ClaudeClient } = await import('../models/claude-client');
          client = new ClaudeClient({
            apiKey: this.config.apiKeys.anthropic || process.env.ANTHROPIC_API_KEY,
            model: modelName
          });
          break;
          
        case 'grok':
          const { default: GrokClient } = await import('../models/grok-client');
          client = new GrokClient({
            apiKey: this.config.apiKeys.grok || process.env.GROK_API_KEY,
            model: modelName
          });
          break;
          
        default:
          throw new Error(`Unknown provider for model: ${modelName}`);
      }
      
      // Initialize the client
      await client.initialize();
      
      // Store the client
      this.modelClients.set(modelName, client);
      
      // Initialize metrics for this model
      this.modelMetrics.set(modelName, {
        calls: 0,
        successes: 0,
        failures: 0,
        totalLatency: 0,
        averageLatency: 0,
        totalTokens: 0
      });
      
      logger.info(`Model client initialized for ${modelName}`);
      
      return client;
    } catch (error) {
      logger.error(`Error initializing model client for ${modelName}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Determine provider from model name
   * 
   * @param {string} modelName - Name of the model
   * @returns {string} Provider name
   */
  getProviderFromModel(modelName) {
    if (modelName.startsWith('gpt-') || modelName.includes('openai')) {
      return 'openai';
    } else if (modelName.startsWith('claude') || modelName.includes('anthropic')) {
      return 'anthropic';
    } else if (modelName.startsWith('grok') || modelName.includes('grok')) {
      return 'grok';
    } else {
      // Default to OpenAI
      return 'openai';
    }
  }
  
  /**
   * Execute a task
   * 
   * @param {Object} task - Task to execute
   * @returns {Object} Task result
   */
  async executeTask(task) {
    if (!this.isReady) {
      await this.initialize();
    }
    
    // Validate task
    if (!task || typeof task !== 'object') {
      throw new Error('Invalid task: must be an object');
    }
    
    // Ensure task has an ID
    const taskId = task.id || `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    task.id = taskId;
    
    try {
      // Check if we're already at max capacity
      if (this.activeTasks.size >= this.config.maxConcurrentTasks) {
        throw new Error(`Agent ${this.config.id} is at max capacity (${this.config.maxConcurrentTasks} tasks)`);
      }
      
      // Log task start
      logger.info(`Agent ${this.config.id} starting task ${taskId}`);
      if (this.config.logTaskInputOutput) {
        logger.debug(`Task input: ${JSON.stringify(task)}`);
      }
      
      // Update agent status
      this.status = 'working';
      this.activeTasks.set(taskId, {
        task,
        startTime: Date.now(),
        status: 'running'
      });
      
      // Set timeout for the task
      this.taskTimeouts.set(taskId, setTimeout(() => {
        this.handleTaskTimeout(taskId);
      }, this.config.taskTimeout));
      
      // Emit task started event
      this.emit('task:started', { taskId, task });
      
      // Process the task (to be implemented by subclasses)
      let result;
      try {
        result = await this.processTask(task);
      } catch (processingError) {
        // Handle task processing error
        const taskInfo = this.activeTasks.get(taskId);
        taskInfo.status = 'error';
        taskInfo.error = processingError.message;
        
        // Check if we should retry
        if (this.config.retryEnabled && taskInfo.retryCount < this.config.maxRetries) {
          taskInfo.retryCount = (taskInfo.retryCount || 0) + 1;
          
          logger.warn(`Task ${taskId} failed, retrying (${taskInfo.retryCount}/${this.config.maxRetries}): ${processingError.message}`);
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * taskInfo.retryCount));
          
          // Retry the task
          result = await this.processTask(task);
        } else {
          // No more retries, propagate the error
          throw processingError;
        }
      }
      
      // Clear the timeout
      if (this.taskTimeouts.has(taskId)) {
        clearTimeout(this.taskTimeouts.get(taskId));
        this.taskTimeouts.delete(taskId);
      }
      
      // Update task history
      this.taskHistory.push({
        taskId,
        type: task.type,
        startTime: this.activeTasks.get(taskId).startTime,
        endTime: Date.now(),
        success: true
      });
      
      // Remove from active tasks
      this.activeTasks.delete(taskId);
      
      // Update agent status if no more active tasks
      if (this.activeTasks.size === 0) {
        this.status = 'idle';
      }
      
      // Log task completion
      logger.info(`Agent ${this.config.id} completed task ${taskId}`);
      if (this.config.logTaskInputOutput) {
        logger.debug(`Task output: ${JSON.stringify(result)}`);
      }
      
      // Emit task completed event
      this.emit('task:completed', { taskId, task, result });
      
      return result;
    } catch (error) {
      // Handle task failure
      
      // Clear the timeout if it exists
      if (this.taskTimeouts.has(taskId)) {
        clearTimeout(this.taskTimeouts.get(taskId));
        this.taskTimeouts.delete(taskId);
      }
      
      // Update task history
      this.taskHistory.push({
        taskId,
        type: task.type,
        startTime: this.activeTasks.get(taskId)?.startTime || Date.now(),
        endTime: Date.now(),
        success: false,
        error: error.message
      });
      
      // Remove from active tasks
      this.activeTasks.delete(taskId);
      
      // Update agent status if no more active tasks
      if (this.activeTasks.size === 0) {
        this.status = 'idle';
      } else {
        this.status = 'working';
      }
      
      // Log task failure
      logger.error(`Agent ${this.config.id} failed task ${taskId}: ${error.message}`);
      
      // Emit task failed event
      this.emit('task:failed', { taskId, task, error });
      
      throw error;
    }
  }
  
  /**
   * Process a task (to be implemented by subclasses)
   * 
   * @param {Object} task - Task to process
   * @returns {Object} Task result
   */
  async processTask(task) {
    throw new Error('processTask method must be implemented by subclasses');
  }
  
  /**
   * Handle task timeout
   * 
   * @param {string} taskId - ID of the timed out task
   */
  handleTaskTimeout(taskId) {
    const taskInfo = this.activeTasks.get(taskId);
    
    if (!taskInfo) {
      return;
    }
    
    // Update task info
    taskInfo.status = 'timeout';
    
    // Log timeout
    logger.warn(`Task ${taskId} timed out after ${this.config.taskTimeout}ms`);
    
    // Emit timeout event
    this.emit('task:timeout', { 
      taskId, 
      task: taskInfo.task, 
      timeoutMs: this.config.taskTimeout 
    });
  }
  
  /**
   * Generate text using the model
   * 
   * @param {string} prompt - Prompt to send to the model
   * @param {Object} options - Generation options
   * @returns {string} Generated text
   */
  async generateText(prompt, options = {}) {
    if (!this.isReady) {
      await this.initialize();
    }
    
    // Default to primary model
    const modelName = options.model || this.config.model;
    let client;
    
    try {
      // Get or initialize the model client
      client = await this.initializeModelClient(modelName);
    } catch (modelError) {
      // Try fallback models if primary fails
      logger.warn(`Failed to use model ${modelName}, trying fallbacks: ${modelError.message}`);
      
      let fallbackClient = null;
      
      for (const fallbackModel of this.config.fallbackModels) {
        try {
          fallbackClient = await this.initializeModelClient(fallbackModel);
          logger.info(`Using fallback model ${fallbackModel} instead of ${modelName}`);
          break;
        } catch (fallbackError) {
          logger.warn(`Fallback model ${fallbackModel} also failed: ${fallbackError.message}`);
        }
      }
      
      if (!fallbackClient) {
        throw new Error(`Failed to initialize primary model ${modelName} and all fallbacks`);
      }
      
      client = fallbackClient;
    }
    
    try {
      // Start timing
      const startTime = Date.now();
      
      // Generate text
      const result = await client.generateText(prompt, options);
      
      // End timing
      const endTime = Date.now();
      const latency = endTime - startTime;
      
      // Update model metrics
      this.updateModelMetrics(client.modelName, {
        success: true,
        latency,
        tokensIn: result.usage?.prompt_tokens || 0,
        tokensOut: result.usage?.completion_tokens || 0
      });
      
      return result.text;
    } catch (error) {
      // Update model metrics
      this.updateModelMetrics(client.modelName, {
        success: false
      });
      
      logger.error(`Error generating text with model ${client.modelName}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Update model metrics
   * 
   * @param {string} modelName - Name of the model
   * @param {Object} metrics - Metrics to update
   */
  updateModelMetrics(modelName, metrics) {
    if (!this.modelMetrics.has(modelName)) {
      this.modelMetrics.set(modelName, {
        calls: 0,
        successes: 0,
        failures: 0,
        totalLatency: 0,
        averageLatency: 0,
        totalTokens: 0
      });
    }
    
    const modelMetrics = this.modelMetrics.get(modelName);
    modelMetrics.calls++;
    
    if (metrics.success) {
      modelMetrics.successes++;
      modelMetrics.totalLatency += metrics.latency || 0;
      modelMetrics.averageLatency = modelMetrics.totalLatency / modelMetrics.successes;
      modelMetrics.totalTokens += (metrics.tokensIn || 0) + (metrics.tokensOut || 0);
    } else {
      modelMetrics.failures++;
    }
  }
  
  /**
   * Store data in shared state
   * 
   * @param {string|Array} path - Path in the state
   * @param {any} value - Value to store
   * @param {Object} metadata - Optional metadata
   * @returns {boolean} Success flag
   */
  async storeState(path, value, metadata = {}) {
    if (!this.config.useSharedState || !this.sharedState) {
      throw new Error('Shared state is not enabled for this agent');
    }
    
    try {
      await this.sharedState.set(path, value, {
        agentId: this.config.id,
        agentType: this.config.type,
        timestamp: Date.now(),
        ...metadata
      });
      
      return true;
    } catch (error) {
      logger.error(`Error storing state at ${path}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get data from shared state
   * 
   * @param {string|Array} path - Path in the state
   * @returns {any} Retrieved value
   */
  async getState(path) {
    if (!this.config.useSharedState || !this.sharedState) {
      throw new Error('Shared state is not enabled for this agent');
    }
    
    try {
      return await this.sharedState.get(path);
    } catch (error) {
      logger.error(`Error getting state from ${path}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Send a message to another agent
   * 
   * @param {string} targetAgent - ID of target agent
   * @param {Object} message - Message to send
   * @param {Object} options - Message options
   * @returns {boolean} Success flag
   */
  async sendMessage(targetAgent, message, options = {}) {
    if (!this.config.useMessageQueue || !this.messageQueue) {
      throw new Error('Message queue is not enabled for this agent');
    }
    
    try {
      await this.messageQueue.sendMessage(`agent-${targetAgent}`, {
        from: this.config.id,
        to: targetAgent,
        timestamp: Date.now(),
        message
      }, options);
      
      return true;
    } catch (error) {
      logger.error(`Error sending message to agent ${targetAgent}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Set up a subscription to receive messages
   * 
   * @param {Function} messageHandler - Function to handle messages
   * @param {Object} options - Subscription options
   * @returns {Object} Subscription handle
   */
  async subscribeToMessages(messageHandler, options = {}) {
    if (!this.config.useMessageQueue || !this.messageQueue) {
      throw new Error('Message queue is not enabled for this agent');
    }
    
    try {
      const subscription = await this.messageQueue.subscribe(
        `agent-${this.config.id}`,
        (message) => messageHandler(message.payload, message),
        options
      );
      
      logger.info(`Agent ${this.config.id} subscribed to messages`);
      
      return subscription;
    } catch (error) {
      logger.error(`Error subscribing to messages: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Store knowledge in the knowledge base
   * 
   * @param {string} category - Knowledge category
   * @param {string} key - Entry key
   * @param {Object} entry - Knowledge entry
   * @returns {Object} Stored entry
   */
  async storeKnowledge(category, key, entry) {
    if (!this.config.useKnowledgeBase || !this.knowledgeBase) {
      throw new Error('Knowledge base is not enabled for this agent');
    }
    
    try {
      return await this.knowledgeBase.storeEntry(category, key, {
        ...entry,
        agent: this.config.id,
        agentType: this.config.type
      });
    } catch (error) {
      logger.error(`Error storing knowledge entry ${category}/${key}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Search the knowledge base
   * 
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Array<Object>} Search results
   */
  async searchKnowledge(query, options = {}) {
    if (!this.config.useKnowledgeBase || !this.knowledgeBase) {
      throw new Error('Knowledge base is not enabled for this agent');
    }
    
    try {
      return await this.knowledgeBase.search(query, options);
    } catch (error) {
      logger.error(`Error searching knowledge base: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get metrics about the agent's performance
   * 
   * @returns {Object} Agent metrics
   */
  getMetrics() {
    // Calculate overall metrics
    const totalTasks = this.taskHistory.length;
    const successfulTasks = this.taskHistory.filter(t => t.success).length;
    const failedTasks = this.taskHistory.filter(t => !t.success).length;
    const successRate = totalTasks > 0 ? (successfulTasks / totalTasks) : 0;
    
    // Calculate average task duration
    const completedTasks = this.taskHistory.filter(t => t.endTime && t.startTime);
    let averageTaskDuration = 0;
    
    if (completedTasks.length > 0) {
      const totalDuration = completedTasks.reduce(
        (sum, task) => sum + (task.endTime - task.startTime), 
        0
      );
      averageTaskDuration = totalDuration / completedTasks.length;
    }
    
    return {
      agentId: this.config.id,
      agentType: this.config.type,
      status: this.status,
      activeTasks: this.activeTasks.size,
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      totalTasks,
      successfulTasks,
      failedTasks,
      successRate,
      averageTaskDuration,
      modelMetrics: Object.fromEntries(this.modelMetrics),
      uptime: Date.now() - this._startTime,
      timestamp: Date.now()
    };
  }
  
  /**
   * Clean up resources
   */
  async shutdown() {
    try {
      // Clear all timeouts
      for (const timeout of this.taskTimeouts.values()) {
        clearTimeout(timeout);
      }
      this.taskTimeouts.clear();
      
      // Update status
      this.status = 'shutdown';
      this.isReady = false;
      
      // Shut down dependencies
      if (this.config.useSharedState && this.sharedState) {
        await this.sharedState.shutdown();
      }
      
      if (this.config.useMessageQueue && this.messageQueue) {
        await this.messageQueue.disconnect();
      }
      
      if (this.config.useKnowledgeBase && this.knowledgeBase) {
        await this.knowledgeBase.shutdown();
      }
      
      logger.info(`Agent ${this.config.id} shut down`);
      this.emit('shutdown');
      
      return true;
    } catch (error) {
      logger.error(`Error shutting down agent ${this.config.id}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = BaseAgent;
