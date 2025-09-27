const logger = require('../../utils/logger');
const MessageQueue = require('../communication/message-queue');
const SharedState = require('../communication/shared-state');
const KnowledgeBase = require('../memory/knowledge-base');
const { getModelClient } = require('../../models/model-orchestrator');

/**
 * ErrorHandler class responsible for detecting, diagnosing, and resolving
 * errors that occur during the software development process
 */
class ErrorHandler {
  constructor() {
    this.messageQueue = new MessageQueue();
    this.sharedState = new SharedState();
    this.knowledgeBase = new KnowledgeBase();
    this.modelClient = null;
    
    // Error resolution strategies
    this.resolutionStrategies = {
      'task_failure': this.handleTaskFailure.bind(this),
      'agent_failure': this.handleAgentFailure.bind(this),
      'state_inconsistency': this.handleStateInconsistency.bind(this),
      'resource_limit': this.handleResourceLimit.bind(this),
      'security_issue': this.handleSecurityIssue.bind(this),
      'integration_error': this.handleIntegrationError.bind(this),
      'external_dependency': this.handleExternalDependency.bind(this),
      'unknown': this.handleUnknownError.bind(this)
    };
    
    // Error severity levels and their implications
    this.severityLevels = {
      'critical': {
        description: 'System cannot continue, requires immediate attention',
        actions: ['notify_human', 'pause_system', 'attempt_recovery']
      },
      'high': {
        description: 'Significant impact on functionality, requires prompt attention',
        actions: ['pause_affected_components', 'attempt_recovery', 'notify_agents']
      },
      'medium': {
        description: 'Limited impact on functionality, can continue with workarounds',
        actions: ['attempt_recovery', 'notify_agents']
      },
      'low': {
        description: 'Minor issue, system can continue normally',
        actions: ['log', 'attempt_recovery_background']
      }
    };
  }

  /**
   * Initialize the error handler
   */
  async initialize() {
    try {
      // Initialize model client
      this.modelClient = await getModelClient({
        modelName: 'gpt-4-turbo',
        temperature: 0.1, // Low temperature for more predictable error handling
        maxTokens: 2000
      });
      
      // Register event listeners
      this.registerEventListeners();
      
      // Load error handling knowledge
      await this.loadErrorHandlingKnowledge();
      
      logger.info('ErrorHandler initialized');
    } catch (error) {
      logger.error(`Error initializing ErrorHandler: ${error.message}`);
      throw error;
    }
  }

  /**
   * Register event listeners for error events
   */
  registerEventListeners() {
    // Listen for error events
    this.messageQueue.subscribe('system.error', this.handleSystemError.bind(this));
    this.messageQueue.subscribe('agent.error', this.handleAgentError.bind(this));
    this.messageQueue.subscribe('task.failed', this.handleTaskError.bind(this));
    
    // Listen for error resolution requests
    this.messageQueue.subscribe('error.resolution_requested', this.handleResolutionRequest.bind(this));
    
    // Listen for error status update requests
    this.messageQueue.subscribe('error.status_update', this.handleErrorStatusUpdate.bind(this));
  }

  /**
   * Load error handling knowledge from knowledge base
   */
  async loadErrorHandlingKnowledge() {
    try {
      // Load common error patterns
      await this.knowledgeBase.loadKnowledge('error_handling.common_patterns');
      
      // Load error resolution strategies
      await this.knowledgeBase.loadKnowledge('error_handling.resolution_strategies');
      
      // Load custom error handling rules if available
      const customRules = await this.knowledgeBase.retrieveKnowledge('error_handling.custom_rules');
      
      if (customRules) {
        // Merge custom resolution strategies
        if (customRules.resolutionStrategies) {
          this.resolutionStrategies = {
            ...this.resolutionStrategies,
            ...customRules.resolutionStrategies
          };
        }
        
        // Merge custom severity levels
        if (customRules.severityLevels) {
          this.severityLevels = {
            ...this.severityLevels,
            ...customRules.severityLevels
          };
        }
      }
      
      logger.info('Loaded error handling knowledge');
    } catch (error) {
      logger.error(`Error loading error handling knowledge: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle a system error
   * @param {Object} message - The message containing error info
   */
  async handleSystemError(message) {
    const { error, source, context, severity = 'medium' } = message;
    
    logger.error(`System error from ${source}: ${error}`, { severity });
    
    // Create error record
    const errorRecord = {
      id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'system_error',
      source,
      message: error,
      context,
      severity,
      timestamp: Date.now(),
      status: 'new',
      resolution: null
    };
    
    // Add to error log
    await this.addErrorToLog(errorRecord);
    
    // Diagnose the error
    const diagnosis = await this.diagnoseError(errorRecord);
    
    // Update error record with diagnosis
    errorRecord.diagnosis = diagnosis;
    errorRecord.errorType = diagnosis.errorType;
    await this.updateErrorInLog(errorRecord);
    
    // Apply resolution strategy
    await this.applyResolutionStrategy(errorRecord, diagnosis);
  }

  /**
   * Handle an agent error
   * @param {Object} message - The message containing error info
   */
  async handleAgentError(message) {
    const { error, agentName, taskId, context, severity = 'medium' } = message;
    
    logger.error(`Agent error from ${agentName}: ${error}`, { severity });
    
    // Create error record
    const errorRecord = {
      id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'agent_error',
      source: agentName,
      message: error,
      taskId,
      context,
      severity,
      timestamp: Date.now(),
      status: 'new',
      resolution: null
    };
    
    // Add to error log
    await this.addErrorToLog(errorRecord);
    
    // Diagnose the error
    const diagnosis = await this.diagnoseError(errorRecord);
    
    // Update error record with diagnosis
    errorRecord.diagnosis = diagnosis;
    errorRecord.errorType = diagnosis.errorType;
    await this.updateErrorInLog(errorRecord);
    
    // Apply resolution strategy
    await this.applyResolutionStrategy(errorRecord, diagnosis);
  }

  /**
   * Handle a task error
   * @param {Object} message - The message containing error info
   */
  async handleTaskError(message) {
    const { error, taskId, agentName, context, severity = 'medium' } = message;
    
    logger.error(`Task error for ${taskId} from ${agentName}: ${error}`, { severity });
    
    // Create error record
    const errorRecord = {
      id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'task_error',
      source: agentName,
      taskId,
      message: error,
      context,
      severity,
      timestamp: Date.now(),
      status: 'new',
      resolution: null
    };
    
    // Add to error log
    await this.addErrorToLog(errorRecord);
    
    // Diagnose the error
    const diagnosis = await this.diagnoseError(errorRecord);
    
    // Update error record with diagnosis
    errorRecord.diagnosis = diagnosis;
    errorRecord.errorType = diagnosis.errorType;
    await this.updateErrorInLog(errorRecord);
    
    // Apply resolution strategy
    await this.applyResolutionStrategy(errorRecord, diagnosis);
  }

  /**
   * Add an error to the error log
   * @param {Object} errorRecord - The error record to add
   */
  async addErrorToLog(errorRecord) {
    try {
      // Get current error log
      const errorLog = await this.sharedState.get('system.error_log') || [];
      
      // Add error record
      errorLog.push(errorRecord);
      
      // Save updated error log
      await this.sharedState.set('system.error_log', errorLog);
      
      // Publish error logged event
      await this.messageQueue.publish('error.logged', {
        errorId: errorRecord.id,
        errorType: errorRecord.type,
        severity: errorRecord.severity,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error adding to error log: ${error.message}`);
    }
  }

  /**
   * Update an error in the error log
   * @param {Object} errorRecord - The updated error record
   */
  async updateErrorInLog(errorRecord) {
    try {
      // Get current error log
      const errorLog = await this.sharedState.get('system.error_log') || [];
      
      // Find and update the error record
      const index = errorLog.findIndex(err => err.id === errorRecord.id);
      
      if (index >= 0) {
        errorLog[index] = errorRecord;
        
        // Save updated error log
        await this.sharedState.set('system.error_log', errorLog);
        
        // Publish error updated event
        await this.messageQueue.publish('error.updated', {
          errorId: errorRecord.id,
          status: errorRecord.status,
          timestamp: Date.now()
        });
      } else {
        logger.warn(`Error record ${errorRecord.id} not found in log`);
      }
    } catch (error) {
      logger.error(`Error updating error log: ${error.message}`);
    }
  }

  /**
   * Diagnose an error to determine its type and possible resolutions
   * @param {Object} errorRecord - The error record to diagnose
   * @returns {Object} The diagnosis results
   */
  async diagnoseError(errorRecord) {
    try {
      // Use common error patterns to identify error type
      const commonPatterns = await this.knowledgeBase.retrieveKnowledge('error_handling.common_patterns') || {};
      
      // Try to match error message against known patterns
      let errorType = 'unknown';
      
      for (const [type, patterns] of Object.entries(commonPatterns)) {
        for (const pattern of patterns) {
          if (errorRecord.message.includes(pattern)) {
            errorType = type;
            break;
          }
        }
        
        if (errorType !== 'unknown') {
          break;
        }
      }
      
      // If still unknown, use AI to classify
      if (errorType === 'unknown' && this.modelClient) {
        errorType = await this.classifyErrorWithAI(errorRecord);
      }
      
      // Determine potential resolutions
      const resolutions = await this.determineResolutions(errorType, errorRecord);
      
      return {
        errorType,
        resolutions,
        confidence: errorType === 'unknown' ? 'low' : 'high'
      };
    } catch (error) {
      logger.error(`Error diagnosing error: ${error.message}`);
      
      // Return basic diagnosis
      return {
        errorType: 'unknown',
        resolutions: [],
        confidence: 'low'
      };
    }
  }

  /**
   * Classify an error using AI
   * @param {Object} errorRecord - The error record to classify
   * @returns {String} The classified error type
   */
  async classifyErrorWithAI(errorRecord) {
    try {
      const prompt = `You are an error classification AI. Your task is to classify the following error into one of these categories:
- task_failure: Errors related to specific task execution
- agent_failure: Errors related to agent behavior or state
- state_inconsistency: Errors related to inconsistent or invalid system state
- resource_limit: Errors related to resource constraints (memory, CPU, tokens, etc.)
- security_issue: Errors related to security violations or concerns
- integration_error: Errors related to integration between components
- external_dependency: Errors related to external services or dependencies
- unknown: Cannot determine the error type

Error details:
Type: ${errorRecord.type}
Source: ${errorRecord.source}
Message: ${errorRecord.message}
Context: ${JSON.stringify(errorRecord.context || {})}

Respond with just one of the category names listed above that best matches this error.`;

      const response = await this.modelClient.complete(prompt);
      
      // Clean up and normalize response
      const errorType = response.trim().toLowerCase();
      
      // Verify it's one of our types
      const validTypes = [
        'task_failure', 'agent_failure', 'state_inconsistency', 
        'resource_limit', 'security_issue', 'integration_error',
        'external_dependency', 'unknown'
      ];
      
      if (validTypes.includes(errorType)) {
        return errorType;
      }
      
      return 'unknown';
    } catch (error) {
      logger.error(`Error classifying error with AI: ${error.message}`);
      return 'unknown';
    }
  }

  /**
   * Determine potential resolutions for an error
   * @param {String} errorType - The type of error
   * @param {Object} errorRecord - The error record
   * @returns {Array} Potential resolutions
   */
  async determineResolutions(errorType, errorRecord) {
    try {
      // Get resolution strategies
      const strategies = await this.knowledgeBase.retrieveKnowledge('error_handling.resolution_strategies') || {};
      
      // Get resolutions for this error type
      const typeStrategies = strategies[errorType] || strategies.unknown || [];
      
      // Filter and rank strategies based on context
      const rankedStrategies = typeStrategies
        .filter(strategy => {
          // Check if strategy applies to this context
          if (strategy.applicableContexts) {
            // If specific contexts are defined, check if this error matches
            if (errorRecord.context) {
              for (const contextKey of strategy.applicableContexts) {
                if (errorRecord.context[contextKey]) {
                  return true;
                }
              }
              return false;
            }
          }
          
          // No context restrictions or no context in error
          return true;
        })
        .map(strategy => ({
          ...strategy,
          // Calculate relevance score
          relevanceScore: this.calculateStrategyRelevance(strategy, errorRecord)
        }));
      
      // Sort by relevance score (descending)
      rankedStrategies.sort((a, b) => b.relevanceScore - a.relevanceScore);
      
      return rankedStrategies;
    } catch (error) {
      logger.error(`Error determining resolutions: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate how relevant a strategy is for a specific error
   * @param {Object} strategy - The resolution strategy
   * @param {Object} errorRecord - The error record
   * @returns {Number} Relevance score (0-100)
   */
  calculateStrategyRelevance(strategy, errorRecord) {
    let score = 50; // Base score
    
    // Adjust based on strategy success rate if available
    if (strategy.successRate !== undefined) {
      score += strategy.successRate * 0.2;
    }
    
    // Adjust based on severity match
    if (strategy.targetSeverity === errorRecord.severity) {
      score += 15;
    }
    
    // Adjust based on source match
    if (strategy.targetSources && strategy.targetSources.includes(errorRecord.source)) {
      score += 10;
    }
    
    // Adjust based on message keywords
    if (strategy.messageKeywords) {
      for (const keyword of strategy.messageKeywords) {
        if (errorRecord.message.includes(keyword)) {
          score += 5;
          break;
        }
      }
    }
    
    // Cap score at 100
    return Math.min(score, 100);
  }

  /**
   * Apply a resolution strategy to an error
   * @param {Object} errorRecord - The error record
   * @param {Object} diagnosis - The error diagnosis
   */
  async applyResolutionStrategy(errorRecord, diagnosis) {
    try {
      const errorType = diagnosis.errorType;
      
      // Get appropriate resolution strategy handler
      const strategyHandler = this.resolutionStrategies[errorType] || this.resolutionStrategies.unknown;
      
      // Apply the strategy
      const resolution = await strategyHandler(errorRecord, diagnosis);
      
      // Update error record with resolution
      errorRecord.resolution = resolution;
      errorRecord.status = resolution.successful ? 'resolved' : 'failed';
      await this.updateErrorInLog(errorRecord);
      
      // Publish resolution event
      await this.messageQueue.publish('error.resolved', {
        errorId: errorRecord.id,
        errorType: errorRecord.errorType,
        resolution,
        successful: resolution.successful,
        timestamp: Date.now()
      });
      
      logger.info(`Applied resolution strategy for error ${errorRecord.id}: ${resolution.successful ? 'success' : 'failed'}`);
      
      return resolution;
    } catch (error) {
      logger.error(`Error applying resolution strategy: ${error.message}`);
      
      // Update error record with failed resolution
      errorRecord.resolution = {
        strategy: 'error_handler_failure',
        actions: [],
        message: `Failed to apply resolution strategy: ${error.message}`,
        successful: false
      };
      
      errorRecord.status = 'failed';
      await this.updateErrorInLog(errorRecord);
      
      return errorRecord.resolution;
    }
  }

  /**
   * Handle a resolution request
   * @param {Object} message - The message containing resolution request info
   */
  async handleResolutionRequest(message) {
    const { errorId, strategyOverride, requesterId } = message;
    
    logger.info(`Resolution requested for error ${errorId} by ${requesterId}`);
    
    try {
      // Get error log
      const errorLog = await this.sharedState.get('system.error_log') || [];
      
      // Find the error record
      const errorRecord = errorLog.find(err => err.id === errorId);
      
      if (!errorRecord) {
        throw new Error(`Error ${errorId} not found`);
      }
      
      // Check if already resolved
      if (errorRecord.status === 'resolved') {
        await this.messageQueue.publish(`${requesterId}.resolution_response`, {
          errorId,
          message: 'Error already resolved',
          resolution: errorRecord.resolution,
          timestamp: Date.now()
        });
        
        return;
      }
      
      // Apply resolution strategy
      const diagnosis = errorRecord.diagnosis || await this.diagnoseError(errorRecord);
      
      // If strategy override is provided, use it
      if (strategyOverride) {
        diagnosis.resolutions = [strategyOverride];
      }
      
      const resolution = await this.applyResolutionStrategy(errorRecord, diagnosis);
      
      // Notify requestor
      await this.messageQueue.publish(`${requesterId}.resolution_response`, {
        errorId,
        successful: resolution.successful,
        resolution,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error handling resolution request: ${error.message}`);
      
      // Notify requestor about the failure
      await this.messageQueue.publish(`${requesterId}.resolution_response`, {
        errorId,
        successful: false,
        message: error.message,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle an error status update
   * @param {Object} message - The message containing status update info
   */
  async handleErrorStatusUpdate(message) {
    const { errorId, status, resolution, requesterId } = message;
    
    logger.info(`Status update for error ${errorId} to ${status} by ${requesterId}`);
    
    try {
      // Get error log
      const errorLog = await this.sharedState.get('system.error_log') || [];
      
      // Find the error record
      const index = errorLog.findIndex(err => err.id === errorId);
      
      if (index < 0) {
        throw new Error(`Error ${errorId} not found`);
      }
      
      // Update status and resolution if provided
      errorLog[index].status = status;
      
      if (resolution) {
        errorLog[index].resolution = resolution;
      }
      
      // Update timestamp
      errorLog[index].updatedAt = Date.now();
      
      // Save updated error log
      await this.sharedState.set('system.error_log', errorLog);
      
      // Publish error updated event
      await this.messageQueue.publish('error.updated', {
        errorId,
        status,
        timestamp: Date.now()
      });
      
      // Notify requestor
      await this.messageQueue.publish(`${requesterId}.status_update_response`, {
        errorId,
        successful: true,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error handling status update: ${error.message}`);
      
      // Notify requestor about the failure
      await this.messageQueue.publish(`${requesterId}.status_update_response`, {
        errorId,
        successful: false,
        message: error.message,
        timestamp: Date.now()
      });
    }
  }

  // Resolution strategy handlers for different error types
  
  /**
   * Handle task failure errors
   * @param {Object} errorRecord - The error record
   * @param {Object} diagnosis - The error diagnosis
   * @returns {Object} The resolution result
   */
  async handleTaskFailure(errorRecord, diagnosis) {
    logger.info(`Handling task failure for ${errorRecord.id}`);
    
    try {
      // Get task info if available
      let task = null;
      
      if (errorRecord.taskId) {
        const tasks = await this.sharedState.get('tasks') || {};
        
        // Look in all task lists
        for (const status of ['pending', 'inProgress', 'completed', 'failed']) {
          const foundTask = tasks[status]?.find(t => t.id === errorRecord.taskId);
          
          if (foundTask) {
            task = foundTask;
            break;
          }
        }
      }
      
      // If we can't find the task, we can't retry it
      if (!task) {
        return {
          strategy: 'task_failure_no_task',
          actions: ['log_failure'],
          message: 'Task not found in task lists',
          successful: false
        };
      }
      
      // Check retry count
      const retryCount = task.retryCount || 0;
      const maxRetries = task.maxRetries || 3;
      
      if (retryCount >= maxRetries) {
        // No more retries
        return {
          strategy: 'task_failure_max_retries',
          actions: ['log_failure', 'notify_agents'],
          message: `Task has reached maximum retry count (${maxRetries})`,
          successful: false
        };
      }
      
      // Increment retry count
      task.retryCount = retryCount + 1;
      
      // Reset task status to pending
      await this.messageQueue.publish('task.state_change_requested', {
        taskId: task.id,
        status: 'pending',
        additionalData: {
          retryCount: task.retryCount,
          previousError: errorRecord.message,
          retryTimestamp: Date.now()
        },
        requesterId: 'error_handler'
      });
      
      return {
        strategy: 'task_failure_retry',
        actions: ['retry_task'],
        message: `Task scheduled for retry (${task.retryCount}/${maxRetries})`,
        successful: true,
        retryCount: task.retryCount
      };
    } catch (error) {
      logger.error(`Error handling task failure: ${error.message}`);
      
      return {
        strategy: 'task_failure',
        actions: ['log_failure'],
        message: `Failed to handle task failure: ${error.message}`,
        successful: false
      };
    }
  }

  /**
   * Handle agent failure errors
   * @param {Object} errorRecord - The error record
   * @param {Object} diagnosis - The error diagnosis
   * @returns {Object} The resolution result
   */
  async handleAgentFailure(errorRecord, diagnosis) {
    logger.info(`Handling agent failure for ${errorRecord.id}`);
    
    try {
      const agentName = errorRecord.source;
      
      // Get agent status
      const agents = await this.sharedState.get('agents') || {};
      const agent = agents[agentName];
      
      if (!agent) {
        return {
          strategy: 'agent_failure_no_agent',
          actions: ['log_failure'],
          message: 'Agent not found in registry',
          successful: false
        };
      }
      
      // Try to restart the agent
      await this.messageQueue.publish('agent.restart_requested', {
        agentName,
        requesterId: 'error_handler'
      });
      
      // Reassign any in-progress tasks from this agent
      await this.messageQueue.publish('task.reassignment_requested', {
        agentName,
        requesterId: 'error_handler'
      });
      
      return {
        strategy: 'agent_failure_restart',
        actions: ['restart_agent', 'reassign_tasks'],
        message: `Agent restart requested for ${agentName}`,
        successful: true
      };
    } catch (error) {
      logger.error(`Error handling agent failure: ${error.message}`);
      
      return {
        strategy: 'agent_failure',
        actions: ['log_failure'],
        message: `Failed to handle agent failure: ${error.message}`,
        successful: false
      };
    }
  }

  /**
   * Handle state inconsistency errors
   * @param {Object} errorRecord - The error record
   * @param {Object} diagnosis - The error diagnosis
   * @returns {Object} The resolution result
   */
  async handleStateInconsistency(errorRecord, diagnosis) {
    logger.info(`Handling state inconsistency for ${errorRecord.id}`);
    
    try {
      // If context has specific state info, try to correct it
      if (errorRecord.context && errorRecord.context.statePath) {
        const statePath = errorRecord.context.statePath;
        const expectedValue = errorRecord.context.expectedValue;
        const actualValue = errorRecord.context.actualValue;
        
        // If we have an expected value, set state to that value
        if (expectedValue !== undefined) {
          // For simple state paths
          if (!statePath.includes('.')) {
            await this.sharedState.set(statePath, expectedValue);
          } 
          // For nested state paths
          else {
            const parts = statePath.split('.');
            const rootPath = parts[0];
            const rootValue = await this.sharedState.get(rootPath) || {};
            
            // Build updated value by traversing the path
            let currentObj = rootValue;
            for (let i = 1; i < parts.length - 1; i++) {
              if (!currentObj[parts[i]]) {
                currentObj[parts[i]] = {};
              }
              currentObj = currentObj[parts[i]];
            }
            
            // Set the leaf value
            currentObj[parts[parts.length - 1]] = expectedValue;
            
            // Update the root object
            await this.sharedState.set(rootPath, rootValue);
          }
          
          return {
            strategy: 'state_inconsistency_fix',
            actions: ['correct_state'],
            message: `State at ${statePath} corrected to expected value`,
            statePath,
            oldValue: actualValue,
            newValue: expectedValue,
            successful: true
          };
        }
      }
      
      // If we can't determine specific fix, notify about inconsistency
      return {
        strategy: 'state_inconsistency_notify',
        actions: ['log_failure', 'notify_agents'],
        message: 'State inconsistency detected but unable to automatically correct',
        successful: false
      };
    } catch (error) {
      logger.error(`Error handling state inconsistency: ${error.message}`);
      
      return {
        strategy: 'state_inconsistency',
        actions: ['log_failure'],
        message: `Failed to handle state inconsistency: ${error.message}`,
        successful: false
      };
    }
  }

  /**
   * Handle resource limit errors
   * @param {Object} errorRecord - The error record
   * @param {Object} diagnosis - The error diagnosis
   * @returns {Object} The resolution result
   */
  async handleResourceLimit(errorRecord, diagnosis) {
    logger.info(`Handling resource limit for ${errorRecord.id}`);
    
    try {
      // Determine resource type from error message
      const message = errorRecord.message.toLowerCase();
      let resourceType = 'unknown';
      
      if (message.includes('memory') || message.includes('out of memory') || message.includes('heap')) {
        resourceType = 'memory';
      } else if (message.includes('token') || message.includes('tokens')) {
        resourceType = 'tokens';
      } else if (message.includes('cpu') || message.includes('timeout')) {
        resourceType = 'cpu';
      } else if (message.includes('rate limit') || message.includes('throttle')) {
        resourceType = 'rate_limit';
      } else if (message.includes('disk') || message.includes('storage')) {
        resourceType = 'storage';
      }
      
      // Apply resource-specific strategies
      switch (resourceType) {
        case 'memory':
          // Suggest reducing batch size or simplifying task
          return {
            strategy: 'resource_limit_memory',
            actions: ['reduce_complexity', 'retry_with_smaller_scope'],
            message: 'Memory limit reached, retrying with reduced scope',
            resourceType,
            successful: true
          };
          
        case 'tokens':
          // Break task into smaller chunks
          return {
            strategy: 'resource_limit_tokens',
            actions: ['chunk_task', 'retry_with_smaller_context'],
            message: 'Token limit reached, retrying with reduced context',
            resourceType,
            successful: true
          };
          
        case 'rate_limit':
          // Implement exponential backoff
          const delayMs = Math.min(30000, Math.pow(2, errorRecord.retryCount || 0) * 1000);
          
          // Schedule retry after delay
          setTimeout(() => {
            this.messageQueue.publish('error.retry_after_backoff', {
              errorId: errorRecord.id,
              delayMs,
              retryCount: (errorRecord.retryCount || 0) + 1
            });
          }, delayMs);
          
          return {
            strategy: 'resource_limit_rate_limit',
            actions: ['exponential_backoff', 'retry_later'],
            message: `Rate limit reached, retrying after ${delayMs}ms delay`,
            resourceType,
            delayMs,
            successful: true
          };
          
        default:
          // Generic resource limit strategy
          return {
            strategy: 'resource_limit_generic',
            actions: ['retry_later', 'notify_agents'],
            message: 'Resource limit reached, scheduling retry',
            resourceType: 'unknown',
            successful: true
          };
      }
    } catch (error) {
      logger.error(`Error handling resource limit: ${error.message}`);
      
      return {
        strategy: 'resource_limit',
        actions: ['log_failure'],
        message: `Failed to handle resource limit: ${error.message}`,
        successful: false
      };
    }
  }

  /**
   * Handle security issue errors
   * @param {Object} errorRecord - The error record
   * @param {Object} diagnosis - The error diagnosis
   * @returns {Object} The resolution result
   */
  async handleSecurityIssue(errorRecord, diagnosis) {
    logger.info(`Handling security issue for ${errorRecord.id}`);
    
    try {
      // For security issues, always notify security agent
      await this.messageQueue.publish('security-agent.security_issue', {
        errorId: errorRecord.id,
        message: errorRecord.message,
        context: errorRecord.context,
        severity: errorRecord.severity,
        timestamp: Date.now()
      });
      
      // If critical severity, pause affected components
      if (errorRecord.severity === 'critical') {
        // Determine affected components
        let affectedComponents = [];
        
        if (errorRecord.context && errorRecord.context.affectedComponents) {
          affectedComponents = errorRecord.context.affectedComponents;
        } else if (errorRecord.source) {
          affectedComponents = [errorRecord.source];
        }
        
        // Pause affected components
        for (const component of affectedComponents) {
          await this.messageQueue.publish(`${component}.pause_requested`, {
            reason: 'security_issue',
            errorId: errorRecord.id,
            requesterId: 'error_handler'
          });
        }
        
        return {
          strategy: 'security_issue_critical',
          actions: ['notify_security_agent', 'pause_components'],
          message: 'Critical security issue detected, affected components paused',
          affectedComponents,
          successful: true
        };
      }
      
      return {
        strategy: 'security_issue_notify',
        actions: ['notify_security_agent'],
        message: 'Security issue detected, security agent notified',
        successful: true
      };
    } catch (error) {
      logger.error(`Error handling security issue: ${error.message}`);
      
      return {
        strategy: 'security_issue',
        actions: ['log_failure'],
        message: `Failed to handle security issue: ${error.message}`,
        successful: false
      };
    }
  }

  /**
   * Handle integration error errors
   * @param {Object} errorRecord - The error record
   * @param {Object} diagnosis - The error diagnosis
   * @returns {Object} The resolution result
   */
  async handleIntegrationError(errorRecord, diagnosis) {
    logger.info(`Handling integration error for ${errorRecord.id}`);
    
    try {
      // Determine affected components
      let components = [];
      
      if (errorRecord.context && errorRecord.context.components) {
        components = errorRecord.context.components;
      } else {
        // Try to extract from error message
        const message = errorRecord.message;
        
        // Look for component names in error message
        const possibleComponents = [
          'frontend', 'backend', 'database', 'api', 
          'authentication', 'storage', 'messaging'
        ];
        
        for (const component of possibleComponents) {
          if (message.toLowerCase().includes(component)) {
            components.push(component);
          }
        }
      }
      
      // If we have identified components, notify the coordination agent
      if (components.length > 0) {
        await this.messageQueue.publish('coordination-agent.integration_issue', {
          errorId: errorRecord.id,
          message: errorRecord.message,
          components,
          timestamp: Date.now()
        });
        
        return {
          strategy: 'integration_error_components',
          actions: ['notify_coordination_agent'],
          message: 'Integration error detected, coordination agent notified',
          components,
          successful: true
        };
      }
      
      // Generic integration error handling
      return {
        strategy: 'integration_error_generic',
        actions: ['notify_coordination_agent', 'log_failure'],
        message: 'Integration error detected, coordination agent notified',
        successful: true
      };
    } catch (error) {
      logger.error(`Error handling integration error: ${error.message}`);
      
      return {
        strategy: 'integration_error',
        actions: ['log_failure'],
        message: `Failed to handle integration error: ${error.message}`,
        successful: false
      };
    }
  }

  /**
   * Handle external dependency errors
   * @param {Object} errorRecord - The error record
   * @param {Object} diagnosis - The error diagnosis
   * @returns {Object} The resolution result
   */
  async handleExternalDependency(errorRecord, diagnosis) {
    logger.info(`Handling external dependency error for ${errorRecord.id}`);
    
    try {
      // Determine external dependency
      let dependency = 'unknown';
      
      if (errorRecord.context && errorRecord.context.dependency) {
        dependency = errorRecord.context.dependency;
      } else {
        // Try to extract from error message
        const message = errorRecord.message.toLowerCase();
        
        if (message.includes('database') || message.includes('db')) {
          dependency = 'database';
        } else if (message.includes('api') || message.includes('service')) {
          dependency = 'external_api';
        } else if (message.includes('network') || message.includes('connection')) {
          dependency = 'network';
        } else if (message.includes('authentication') || message.includes('auth')) {
          dependency = 'authentication';
        } else if (message.includes('file') || message.includes('storage')) {
          dependency = 'storage';
        }
      }
      
      // Implement exponential backoff for retrying
      const retryCount = errorRecord.retryCount || 0;
      const maxRetries = 5;
      
      if (retryCount >= maxRetries) {
        return {
          strategy: 'external_dependency_max_retries',
          actions: ['log_failure', 'notify_devops_agent'],
          message: `External dependency (${dependency}) error reached maximum retries`,
          dependency,
          successful: false
        };
      }
      
      // Calculate backoff delay
      const delayMs = Math.min(60000, Math.pow(2, retryCount) * 1000);
      
      // Schedule retry after delay
      setTimeout(() => {
        this.messageQueue.publish('error.retry_after_backoff', {
          errorId: errorRecord.id,
          dependency,
          delayMs,
          retryCount: retryCount + 1
        });
      }, delayMs);
      
      return {
        strategy: 'external_dependency_backoff',
        actions: ['exponential_backoff', 'retry_later'],
        message: `External dependency (${dependency}) error, retrying after ${delayMs}ms delay`,
        dependency,
        delayMs,
        retryCount: retryCount + 1,
        successful: true
      };
    } catch (error) {
      logger.error(`Error handling external dependency: ${error.message}`);
      
      return {
        strategy: 'external_dependency',
        actions: ['log_failure'],
        message: `Failed to handle external dependency error: ${error.message}`,
        successful: false
      };
    }
  }

  /**
   * Handle unknown errors
   * @param {Object} errorRecord - The error record
   * @param {Object} diagnosis - The error diagnosis
   * @returns {Object} The resolution result
   */
  async handleUnknownError(errorRecord, diagnosis) {
    logger.info(`Handling unknown error for ${errorRecord.id}`);
    
    try {
      // For critical severity, notify all agents
      if (errorRecord.severity === 'critical') {
        await this.messageQueue.publish('system.critical_error', {
          errorId: errorRecord.id,
          message: errorRecord.message,
          source: errorRecord.source,
          timestamp: Date.now()
        });
        
        return {
          strategy: 'unknown_error_critical',
          actions: ['notify_all_agents', 'log_failure'],
          message: 'Critical unknown error detected, all agents notified',
          successful: false
        };
      }
      
      // For high severity, try to get more info with AI
      if (errorRecord.severity === 'high' && this.modelClient) {
        const analysis = await this.analyzeUnknownErrorWithAI(errorRecord);
        
        // If analysis suggests a type, retry with that type
        if (analysis.suggestedType && analysis.suggestedType !== 'unknown') {
          errorRecord.diagnosis.errorType = analysis.suggestedType;
          return this.applyResolutionStrategy(errorRecord, errorRecord.diagnosis);
        }
        
        return {
          strategy: 'unknown_error_ai_analysis',
          actions: ['ai_analysis', 'log_failure'],
          message: 'Unknown error analyzed with AI, but no clear resolution',
          analysis,
          successful: false
        };
      }
      
      // Default handling for unknown errors
      return {
        strategy: 'unknown_error_default',
        actions: ['log_failure'],
        message: 'Unknown error detected, no specific resolution available',
        successful: false
      };
    } catch (error) {
      logger.error(`Error handling unknown error: ${error.message}`);
      
      return {
        strategy: 'unknown_error',
        actions: ['log_failure'],
        message: `Failed to handle unknown error: ${error.message}`,
        successful: false
      };
    }
  }

  /**
   * Analyze an unknown error using AI
   * @param {Object} errorRecord - The error record
   * @returns {Object} The analysis result
   */
  async analyzeUnknownErrorWithAI(errorRecord) {
    try {
      const prompt = `You are an AI error analysis expert. Your task is to analyze the following error and provide insights.

Error details:
Type: ${errorRecord.type}
Source: ${errorRecord.source}
Message: ${errorRecord.message}
Context: ${JSON.stringify(errorRecord.context || {})}

Please analyze this error and provide:
1. A more specific error type classification
2. Potential root causes
3. Suggested resolution steps
4. Whether this error is likely to recur

Respond in JSON format with these fields:
{
  "suggestedType": "string",
  "rootCauses": ["string"],
  "resolutionSteps": ["string"],
  "likelyToRecur": boolean,
  "confidence": "high|medium|low"
}`;

      const response = await this.modelClient.complete(prompt);
      
      try {
        return JSON.parse(response);
      } catch (parseError) {
        logger.error(`Error parsing AI analysis: ${parseError.message}`);
        
        return {
          suggestedType: 'unknown',
          rootCauses: ['Unable to determine'],
          resolutionSteps: ['Log error for human review'],
          likelyToRecur: true,
          confidence: 'low'
        };
      }
    } catch (error) {
      logger.error(`Error analyzing unknown error with AI: ${error.message}`);
      
      return {
        suggestedType: 'unknown',
        rootCauses: ['AI analysis failed'],
        resolutionSteps: ['Log error for human review'],
        likelyToRecur: true,
        confidence: 'low'
      };
    }
  }
}

module.exports = ErrorHandler;
