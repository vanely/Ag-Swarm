/**
 * Error Handler for the Agentic Software Development Swarm
 * 
 * This module provides robust error recovery and exception handling mechanisms.
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class ErrorHandler extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 5000, // 5 seconds
      errorLogging: config.errorLogging !== false,
      automaticRollback: config.automaticRollback !== false,
      errorCategories: config.errorCategories || {
        // Default error categories and their handling strategies
        'connection': { maxRetries: 5, retryDelay: 10000, action: 'retry' },
        'timeout': { maxRetries: 2, retryDelay: 15000, action: 'retry' },
        'validation': { maxRetries: 0, action: 'fail' },
        'resource': { maxRetries: 3, retryDelay: 30000, action: 'retry' },
        'permission': { maxRetries: 0, action: 'fail' },
        'data': { maxRetries: 2, action: 'retry' },
        'internal': { maxRetries: 1, action: 'retry' },
      },
      errorHandlingStrategies: config.errorHandlingStrategies || {
        // Custom error handling strategies can be defined here
      }
    };
    
    // Error tracking for workflows and tasks
    this.errorCounts = new Map();
    
    logger.info('Error Handler initialized');
    logger.debug(`Error Handler configuration: ${JSON.stringify(this.config)}`);
  }
  
  /**
   * Handle an error that occurred during task execution
   * 
   * @param {Object} workflow - The workflow where the error occurred
   * @param {string|number} taskIdentifier - ID or index of the task that failed
   * @param {Error} error - The error that occurred
   * @returns {Object} Decision object with action to take
   */
  async handleError(workflow, taskIdentifier, error) {
    const taskKey = `${workflow.id}:${taskIdentifier}`;
    const errorInfo = this.analyzeError(error);
    
    if (this.config.errorLogging) {
      logger.error(`Error in workflow ${workflow.id}, task ${taskIdentifier}: ${error.message}`, {
        workflowId: workflow.id,
        taskIdentifier,
        errorType: errorInfo.category,
        stack: error.stack
      });
    }
    
    // Track error count for this task
    const currentCount = this.errorCounts.get(taskKey) || 0;
    this.errorCounts.set(taskKey, currentCount + 1);
    
    // Get error handling strategy
    const strategy = this.getErrorHandlingStrategy(errorInfo.category);
    
    // Emit error event
    this.emit('error:handled', {
      workflowId: workflow.id,
      taskIdentifier,
      error,
      errorInfo,
      attempt: currentCount + 1,
      strategy
    });
    
    // Check if we've exceeded max retries
    if (currentCount >= strategy.maxRetries) {
      // We've exceeded max retries, decide what to do
      if (strategy.action === 'retry') {
        // We've exceeded max retries but still want to retry
        return this.handleExceededRetries(workflow, taskIdentifier, error, errorInfo);
      } else if (strategy.action === 'skip') {
        logger.info(`Skipping task ${taskIdentifier} in workflow ${workflow.id} after ${currentCount} failed attempts`);
        return { action: 'skip', reason: `Exceeded max retries (${strategy.maxRetries})` };
      } else {
        // Default to failing the task
        logger.info(`Failing task ${taskIdentifier} in workflow ${workflow.id} after ${currentCount} failed attempts`);
        return { action: 'fail', reason: `Exceeded max retries (${strategy.maxRetries})` };
      }
    }
    
    // We still have retries left
    if (strategy.action === 'retry') {
      // Delay before retrying if configured
      if (strategy.retryDelay > 0) {
        logger.info(`Retrying task ${taskIdentifier} in workflow ${workflow.id} after ${strategy.retryDelay}ms delay (attempt ${currentCount + 1}/${strategy.maxRetries + 1})`);
        await new Promise(resolve => setTimeout(resolve, strategy.retryDelay));
      } else {
        logger.info(`Retrying task ${taskIdentifier} in workflow ${workflow.id} immediately (attempt ${currentCount + 1}/${strategy.maxRetries + 1})`);
      }
      
      return { action: 'retry', reason: `Automatic retry (${currentCount + 1}/${strategy.maxRetries + 1})` };
    } else if (strategy.action === 'skip') {
      logger.info(`Skipping task ${taskIdentifier} in workflow ${workflow.id} due to error policy`);
      return { action: 'skip', reason: `Error policy dictates skipping` };
    } else if (strategy.action === 'abort') {
      logger.info(`Aborting workflow ${workflow.id} due to error in task ${taskIdentifier}`);
      return { action: 'abort', reason: `Error policy dictates workflow abortion` };
    } else {
      // Default to failing the task
      logger.info(`Failing task ${taskIdentifier} in workflow ${workflow.id} due to error policy`);
      return { action: 'fail', reason: `Error policy dictates failure` };
    }
  }
  
  /**
   * Handle the case where max retries have been exceeded
   * 
   * @param {Object} workflow - The workflow where the error occurred
   * @param {string|number} taskIdentifier - ID or index of the task that failed
   * @param {Error} error - The error that occurred
   * @param {Object} errorInfo - Analyzed error information
   * @returns {Object} Decision object with action to take
   */
  handleExceededRetries(workflow, taskIdentifier, error, errorInfo) {
    // Check if we should attempt rollback
    if (this.config.automaticRollback && this.canRollback(workflow, taskIdentifier)) {
      logger.info(`Initiating rollback for task ${taskIdentifier} in workflow ${workflow.id}`);
      
      // Attempt rollback
      try {
        this.rollbackTask(workflow, taskIdentifier);
        
        // After rollback, decide whether to abort the workflow or just fail this task
        if (errorInfo.severity === 'critical') {
          logger.info(`Aborting workflow ${workflow.id} after rollback due to critical error`);
          return { action: 'abort', reason: 'Critical error after max retries, rolled back' };
        } else {
          logger.info(`Failing task ${taskIdentifier} in workflow ${workflow.id} after rollback`);
          return { action: 'fail', reason: 'Max retries exceeded, rolled back' };
        }
      } catch (rollbackError) {
        // Rollback itself failed
        logger.error(`Rollback failed for task ${taskIdentifier} in workflow ${workflow.id}: ${rollbackError.message}`);
        
        // Always abort if rollback fails
        return { action: 'abort', reason: 'Rollback failed, aborting workflow' };
      }
    } else {
      // No rollback possible or needed
      if (errorInfo.severity === 'critical') {
        logger.info(`Aborting workflow ${workflow.id} due to critical error in task ${taskIdentifier}`);
        return { action: 'abort', reason: 'Critical error after max retries' };
      } else if (errorInfo.recoverable === false) {
        logger.info(`Failing task ${taskIdentifier} in workflow ${workflow.id} due to unrecoverable error`);
        return { action: 'fail', reason: 'Unrecoverable error' };
      } else {
        // By default, fail the task but allow the workflow to continue
        logger.info(`Failing task ${taskIdentifier} in workflow ${workflow.id} after max retries`);
        return { action: 'fail', reason: 'Max retries exceeded' };
      }
    }
  }
  
  /**
   * Analyze an error to categorize it and determine severity
   * 
   * @param {Error} error - The error to analyze
   * @returns {Object} Analysis of the error
   */
  analyzeError(error) {
    // Default error info
    const errorInfo = {
      category: 'unknown',
      severity: 'normal',
      recoverable: true,
      message: error.message
    };
    
    // Check for known error types by message pattern
    if (/connection|network|timeout|econnrefused|socket/i.test(error.message)) {
      errorInfo.category = 'connection';
    } else if (/timeout|timed out/i.test(error.message)) {
      errorInfo.category = 'timeout';
    } else if (/invalid|validation|schema|parameter|argument/i.test(error.message)) {
      errorInfo.category = 'validation';
      errorInfo.recoverable = false;
    } else if (/resource|memory|cpu|disk|quota|limit/i.test(error.message)) {
      errorInfo.category = 'resource';
    } else if (/permission|access|forbidden|unauthorized/i.test(error.message)) {
      errorInfo.category = 'permission';
      errorInfo.recoverable = false;
    } else if (/data|database|query|record|not found/i.test(error.message)) {
      errorInfo.category = 'data';
    } else if (/internal|server|system/i.test(error.message)) {
      errorInfo.category = 'internal';
    }
    
    // Check error stack for additional clues if still unknown
    if (errorInfo.category === 'unknown' && error.stack) {
      if (/api|http|fetch|request|axios/i.test(error.stack)) {
        errorInfo.category = 'connection';
      } else if (/database|sql|mongo|redis|neo4j/i.test(error.stack)) {
        errorInfo.category = 'data';
      } else if (/parse|json|xml|yaml/i.test(error.stack)) {
        errorInfo.category = 'validation';
        errorInfo.recoverable = false;
      }
    }
    
    // Determine severity based on category and message
    if (/critical|fatal|crash|exception|assert/i.test(error.message)) {
      errorInfo.severity = 'critical';
    } else if (errorInfo.category === 'permission' || errorInfo.category === 'validation') {
      errorInfo.severity = 'high';
    } else if (errorInfo.category === 'resource' || errorInfo.category === 'internal') {
      errorInfo.severity = 'medium';
    }
    
    return errorInfo;
  }
  
  /**
   * Get the error handling strategy for a specific error category
   * 
   * @param {string} category - The error category
   * @returns {Object} Error handling strategy
   */
  getErrorHandlingStrategy(category) {
    // Check if we have a specific strategy for this category
    const specificStrategy = this.config.errorCategories[category];
    
    if (specificStrategy) {
      return {
        maxRetries: specificStrategy.maxRetries ?? this.config.maxRetries,
        retryDelay: specificStrategy.retryDelay ?? this.config.retryDelay,
        action: specificStrategy.action ?? 'retry'
      };
    }
    
    // Return default strategy
    return {
      maxRetries: this.config.maxRetries,
      retryDelay: this.config.retryDelay,
      action: 'retry'
    };
  }
  
  /**
   * Check if a task can be rolled back
   * 
   * @param {Object} workflow - The workflow
   * @param {string|number} taskIdentifier - ID or index of the task
   * @returns {boolean} True if the task can be rolled back
   */
  canRollback(workflow, taskIdentifier) {
    // Implement logic to determine if a task can be rolled back
    // This would typically check if the task has a rollback function
    // or if there's a snapshot of the state before the task started
    
    // For now, just return false to indicate no rollback is possible
    return false;
  }
  
  /**
   * Roll back a task to its previous state
   * 
   * @param {Object} workflow - The workflow
   * @param {string|number} taskIdentifier - ID or index of the task
   * @returns {boolean} True if rollback was successful
   */
  rollbackTask(workflow, taskIdentifier) {
    // Implement task rollback logic
    // This would typically restore state from before the task started
    
    // For now, just log that we would roll back
    logger.info(`Would roll back task ${taskIdentifier} in workflow ${workflow.id} (not implemented)`);
    
    // Return true to indicate rollback was successful
    return true;
  }
  
  /**
   * Reset error count for a task
   * 
   * @param {string} workflowId - ID of the workflow
   * @param {string|number} taskIdentifier - ID or index of the task
   */
  resetErrorCount(workflowId, taskIdentifier) {
    const taskKey = `${workflowId}:${taskIdentifier}`;
    this.errorCounts.delete(taskKey);
    
    logger.debug(`Reset error count for task ${taskIdentifier} in workflow ${workflowId}`);
  }
  
  /**
   * Get current error count for a task
   * 
   * @param {string} workflowId - ID of the workflow
   * @param {string|number} taskIdentifier - ID or index of the task
   * @returns {number} Current error count
   */
  getErrorCount(workflowId, taskIdentifier) {
    const taskKey = `${workflowId}:${taskIdentifier}`;
    return this.errorCounts.get(taskKey) || 0;
  }
  
  /**
   * Register a custom error handler for specific error types
   * 
   * @param {string} errorType - Type of error to handle
   * @param {Function} handlerFn - Function to handle the error
   */
  registerCustomErrorHandler(errorType, handlerFn) {
    if (typeof handlerFn !== 'function') {
      throw new Error('Error handler must be a function');
    }
    
    this.config.errorHandlingStrategies[errorType] = handlerFn;
    
    logger.info(`Registered custom error handler for type: ${errorType}`);
  }
  
  /**
   * Handle an unexpected error that occurred outside of normal task execution
   * 
   * @param {Error} error - The error that occurred
   * @param {string} context - Context where the error occurred
   * @returns {Object} Decision object with action to take
   */
  handleUnexpectedError(error, context) {
    if (this.config.errorLogging) {
      logger.error(`Unexpected error in ${context}: ${error.message}`, {
        context,
        stack: error.stack
      });
    }
    
    // Analyze the error
    const errorInfo = this.analyzeError(error);
    
    // Emit error event
    this.emit('error:unexpected', {
      context,
      error,
      errorInfo
    });
    
    // For unexpected errors, we typically recommend to abort whatever operation
    // was in progress to prevent further issues
    return {
      action: 'abort',
      reason: `Unexpected error in ${context}: ${error.message}`
    };
  }
  
  /**
   * Create a standardized error response
   * 
   * @param {string} message - Error message
   * @param {string} code - Error code
   * @param {Object} details - Additional error details
   * @returns {Object} Standardized error response
   */
  createErrorResponse(message, code = 'UNKNOWN_ERROR', details = {}) {
    return {
      error: true,
      code,
      message,
      details,
      timestamp: Date.now()
    };
  }
  
  /**
   * Log error statistics for workflows
   * 
   * @returns {Object} Error statistics
   */
  getErrorStatistics() {
    const statistics = {
      totalErrors: 0,
      errorsByWorkflow: {},
      errorsByCategory: {}
    };
    
    // Count errors by workflow and task
    for (const [key, count] of this.errorCounts.entries()) {
      const [workflowId, taskId] = key.split(':');
      
      statistics.totalErrors += count;
      
      if (!statistics.errorsByWorkflow[workflowId]) {
        statistics.errorsByWorkflow[workflowId] = {
          total: 0,
          byTask: {}
        };
      }
      
      statistics.errorsByWorkflow[workflowId].total += count;
      statistics.errorsByWorkflow[workflowId].byTask[taskId] = count;
    }
    
    return statistics;
  }
  
  /**
   * Clear all error counts
   */
  clearErrorCounts() {
    this.errorCounts.clear();
    logger.info('Cleared all error counts');
  }
}

module.exports = ErrorHandler;
