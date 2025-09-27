/**
 * Message Queue for the Agentic Software Development Swarm
 * 
 * This module provides a high-level interface for message passing between agents
 * using Kafka as the underlying transport.
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');
const KafkaService = require('./kafka-service');

class MessageQueue extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      queuePrefix: config.queuePrefix || 'queue',
      defaultTTL: config.defaultTTL || 3600000, // 1 hour
      retryEnabled: config.retryEnabled !== false,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 5000, // 5 seconds
      deadLetterQueue: config.deadLetterQueue || 'dead-letter',
      priorityLevels: config.priorityLevels || ['high', 'normal', 'low'],
      defaultPriority: config.defaultPriority || 'normal',
      ...config
    };
    
    this.kafkaService = new KafkaService(config.kafka || {});
    this.subscriptions = new Map();
    this.requestHandlers = new Map();
    
    // Track message counts for monitoring
    this.metrics = {
      sentCount: 0,
      receivedCount: 0,
      errorCount: 0,
      deadLetterCount: 0,
      processingTime: {
        count: 0,
        totalMs: 0,
        average: 0
      }
    };
    
    logger.info('Message Queue initialized');
    logger.debug(`Message Queue configuration: ${JSON.stringify(this.config)}`);
  }
  
  /**
   * Connect to the message queue
   */
  async connect() {
    try {
      await this.kafkaService.connect();
      
      // Set up the dead letter queue
      await this.kafkaService.createTopic(this.getQueueName(this.config.deadLetterQueue));
      
      logger.info('Message Queue connected');
      this.emit('connected');
      
      return true;
    } catch (error) {
      logger.error(`Failed to connect to Message Queue: ${error.message}`);
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Get the fully qualified queue name
   * 
   * @param {string} queueName - Base queue name
   * @returns {string} Fully qualified queue name
   */
  getQueueName(queueName) {
    return `${this.config.queuePrefix}-${queueName}`;
  }
  
  /**
   * Get the priority queue name
   * 
   * @param {string} queueName - Base queue name
   * @param {string} priority - Priority level
   * @returns {string} Priority queue name
   */
  getPriorityQueueName(queueName, priority) {
    if (!this.config.priorityLevels.includes(priority)) {
      logger.warn(`Invalid priority level: ${priority}, using default`);
      priority = this.config.defaultPriority;
    }
    
    return `${this.getQueueName(queueName)}-${priority}`;
  }
  
  /**
   * Send a message to a queue
   * 
   * @param {string} queue - Queue to send to
   * @param {Object} message - Message to send
   * @param {Object} options - Message options
   * @returns {Object} Result of the send operation
   */
  async sendMessage(queue, message, options = {}) {
    if (!(await this.kafkaService.checkHealth()).connected) {
      await this.connect();
    }
    
    // Default message options
    const messageOptions = {
      priority: this.config.defaultPriority,
      ttl: this.config.defaultTTL,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      correlationId: options.correlationId || null,
      headers: options.headers || {},
      timestamp: Date.now(),
      retry: {
        enabled: this.config.retryEnabled,
        count: 0,
        maxRetries: this.config.maxRetries,
        delay: this.config.retryDelay
      },
      ...options
    };
    
    // Prepare full message object
    const fullMessage = {
      _meta: {
        messageId: messageOptions.messageId,
        correlationId: messageOptions.correlationId,
        timestamp: messageOptions.timestamp,
        ttl: messageOptions.ttl,
        expiresAt: messageOptions.timestamp + messageOptions.ttl,
        retry: messageOptions.retry
      },
      payload: message
    };
    
    // Determine the target queue name based on priority
    const targetQueue = options.priority ? 
      this.getPriorityQueueName(queue, options.priority) : 
      this.getQueueName(queue);
    
    // Prepare Kafka headers
    const headers = {
      'message-id': messageOptions.messageId,
      'timestamp': `${messageOptions.timestamp}`,
      'ttl': `${messageOptions.ttl}`,
      'priority': messageOptions.priority,
      ...messageOptions.headers
    };
    
    if (messageOptions.correlationId) {
      headers['correlation-id'] = messageOptions.correlationId;
    }
    
    try {
      // Send message to Kafka
      const result = await this.kafkaService.sendMessage(
        targetQueue,
        fullMessage,
        messageOptions.messageId,
        headers
      );
      
      // Update metrics
      this.metrics.sentCount++;
      
      logger.debug(`Sent message ${messageOptions.messageId} to queue ${targetQueue}`);
      
      this.emit('message:sent', {
        queue: targetQueue,
        messageId: messageOptions.messageId,
        priority: messageOptions.priority
      });
      
      return {
        success: true,
        messageId: messageOptions.messageId,
        queue: targetQueue,
        timestamp: messageOptions.timestamp
      };
    } catch (error) {
      // Update metrics
      this.metrics.errorCount++;
      
      logger.error(`Failed to send message to queue ${targetQueue}: ${error.message}`);
      
      this.emit('message:error', {
        queue: targetQueue,
        messageId: messageOptions.messageId,
        error: error.message
      });
      
      throw error;
    }
  }
  
  /**
   * Subscribe to a queue to receive messages
   * 
   * @param {string} queue - Queue to subscribe to
   * @param {Function} messageHandler - Function to handle received messages
   * @param {Object} options - Subscription options
   * @returns {Object} Subscription handle
   */
  async subscribe(queue, messageHandler, options = {}) {
    if (!(await this.kafkaService.checkHealth()).connected) {
      await this.connect();
    }
    
    const subscriptionOptions = {
      consumerId: `consumer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      handleAllPriorities: options.handleAllPriorities !== false,
      priorityLevels: options.priorityLevels || this.config.priorityLevels,
      fromBeginning: options.fromBeginning || false,
      autoAck: options.autoAck !== false,
      concurrentMessages: options.concurrentMessages || 1,
      ...options
    };
    
    // If handling all priorities, subscribe to each priority queue
    if (subscriptionOptions.handleAllPriorities) {
      const prioritySubscriptions = [];
      
      // Subscribe to each priority queue in order (high to low)
      for (const priority of subscriptionOptions.priorityLevels) {
        const priorityQueue = this.getPriorityQueueName(queue, priority);
        
        logger.info(`Subscribing to priority queue ${priorityQueue}`);
        
        const subscription = await this.subscribeToQueue(
          priorityQueue,
          messageHandler,
          {
            ...subscriptionOptions,
            consumerId: `${subscriptionOptions.consumerId}-${priority}`
          }
        );
        
        prioritySubscriptions.push(subscription);
      }
      
      // Create a subscription handle that manages all priority subscriptions
      const subscriptionId = `sub_${queue}_${subscriptionOptions.consumerId}`;
      
      this.subscriptions.set(subscriptionId, {
        queue,
        prioritySubscriptions,
        options: subscriptionOptions
      });
      
      logger.info(`Subscribed to queue ${queue} with all priority levels`);
      
      this.emit('subscription:created', {
        subscriptionId,
        queue,
        priorities: subscriptionOptions.priorityLevels
      });
      
      return {
        subscriptionId,
        queue,
        async unsubscribe() {
          return await this.unsubscribeFromQueue(subscriptionId);
        }
      };
    } else {
      // Just subscribe to the base queue
      const targetQueue = this.getQueueName(queue);
      
      const subscription = await this.subscribeToQueue(
        targetQueue,
        messageHandler,
        subscriptionOptions
      );
      
      const subscriptionId = `sub_${queue}_${subscriptionOptions.consumerId}`;
      
      this.subscriptions.set(subscriptionId, {
        queue,
        subscription,
        options: subscriptionOptions
      });
      
      logger.info(`Subscribed to queue ${targetQueue}`);
      
      this.emit('subscription:created', {
        subscriptionId,
        queue: targetQueue
      });
      
      return {
        subscriptionId,
        queue: targetQueue,
        async unsubscribe() {
          return await this.unsubscribeFromQueue(subscriptionId);
        }
      };
    }
  }
  
  /**
   * Subscribe to a specific queue
   * 
   * @param {string} queueName - Fully qualified queue name
   * @param {Function} messageHandler - Function to handle received messages
   * @param {Object} options - Subscription options
   * @returns {Object} Kafka subscription
   */
  async subscribeToQueue(queueName, messageHandler, options) {
    // Create a wrapper around the message handler to handle metadata, retries, etc.
    const wrappedHandler = async (kafkaMessage) => {
      try {
        const startTime = Date.now();
        const message = kafkaMessage.value;
        
        // Check if message is expired
        if (message._meta && message._meta.expiresAt < Date.now()) {
          logger.warn(`Received expired message ${message._meta.messageId} in queue ${queueName}`);
          return;
        }
        
        // Update metrics
        this.metrics.receivedCount++;
        
        logger.debug(`Processing message ${message._meta.messageId} from queue ${queueName}`);
        
        try {
          // Call the user's message handler
          await messageHandler({
            payload: message.payload,
            messageId: message._meta.messageId,
            correlationId: message._meta.correlationId,
            timestamp: message._meta.timestamp,
            headers: kafkaMessage.headers,
            // Add acknowledgement function if not auto-ack
            ...(options.autoAck ? {} : {
              ack: async () => {
                logger.debug(`Message ${message._meta.messageId} acknowledged`);
                // Nothing to do for Kafka
              },
              nack: async (requeue = true) => {
                logger.debug(`Message ${message._meta.messageId} negative acknowledged, requeue: ${requeue}`);
                
                if (requeue) {
                  // Implement requeuing logic
                  await this.requeueMessage(queueName, message);
                } else {
                  // Send to dead letter queue
                  await this.sendToDeadLetterQueue(message, queueName, 'nack');
                }
              }
            })
          });
          
          // Calculate processing time
          const processingTime = Date.now() - startTime;
          
          // Update metrics
          this.metrics.processingTime.count++;
          this.metrics.processingTime.totalMs += processingTime;
          this.metrics.processingTime.average = 
            this.metrics.processingTime.totalMs / this.metrics.processingTime.count;
          
          logger.debug(`Successfully processed message ${message._meta.messageId} in ${processingTime}ms`);
          
          this.emit('message:processed', {
            queue: queueName,
            messageId: message._meta.messageId,
            processingTime
          });
        } catch (error) {
          logger.error(`Error processing message ${message._meta.messageId} from queue ${queueName}: ${error.message}`);
          
          // Check if we should retry
          if (
            message._meta.retry && 
            message._meta.retry.enabled && 
            message._meta.retry.count < message._meta.retry.maxRetries
          ) {
            await this.retryMessage(queueName, message, error);
          } else {
            // Send to dead letter queue
            await this.sendToDeadLetterQueue(message, queueName, error.message);
          }
          
          throw error;
        }
      } catch (error) {
        logger.error(`Error in message handler wrapper: ${error.message}`);
        
        // Update metrics
        this.metrics.errorCount++;
        
        this.emit('message:error', {
          queue: queueName,
          error: error.message
        });
      }
    };
    
    // Subscribe to the Kafka topic
    return await this.kafkaService.subscribe(
      queueName,
      wrappedHandler,
      {
        fromBeginning: options.fromBeginning,
        concurrentPartitions: options.concurrentMessages
      }
    );
  }
  
  /**
   * Unsubscribe from a queue
   * 
   * @param {string} subscriptionId - ID of the subscription to cancel
   * @returns {boolean} True if successful
   */
  async unsubscribeFromQueue(subscriptionId) {
    const subscriptionInfo = this.subscriptions.get(subscriptionId);
    
    if (!subscriptionInfo) {
      logger.warn(`No subscription found with ID ${subscriptionId}`);
      return false;
    }
    
    try {
      if (subscriptionInfo.prioritySubscriptions) {
        // Unsubscribe from all priority queues
        for (const subscription of subscriptionInfo.prioritySubscriptions) {
          await subscription.unsubscribe();
        }
      } else if (subscriptionInfo.subscription) {
        // Unsubscribe from the single queue
        await subscriptionInfo.subscription.unsubscribe();
      }
      
      this.subscriptions.delete(subscriptionId);
      
      logger.info(`Unsubscribed from queue ${subscriptionInfo.queue}`);
      
      this.emit('subscription:cancelled', {
        subscriptionId,
        queue: subscriptionInfo.queue
      });
      
      return true;
    } catch (error) {
      logger.error(`Failed to unsubscribe from queue ${subscriptionInfo.queue}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Requeue a message for retry
   * 
   * @param {string} queue - Queue the message was from
   * @param {Object} message - Message to retry
   * @param {Error} error - Error that caused the retry
   */
  async retryMessage(queue, message, error) {
    // Increment retry count
    message._meta.retry.count++;
    
    // Calculate delay
    const delay = message._meta.retry.delay * Math.pow(2, message._meta.retry.count - 1); // Exponential backoff
    
    logger.info(`Requeuing message ${message._meta.messageId} to queue ${queue} for retry (${message._meta.retry.count}/${message._meta.retry.maxRetries}) after ${delay}ms`);
    
    // Wait for delay
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      // Send back to the original queue
      await this.kafkaService.sendMessage(
        queue,
        message,
        message._meta.messageId,
        {
          'message-id': message._meta.messageId,
          'timestamp': `${Date.now()}`,
          'ttl': `${message._meta.ttl}`,
          'retry-count': `${message._meta.retry.count}`,
          'original-timestamp': `${message._meta.timestamp}`
        }
      );
      
      logger.debug(`Successfully requeued message ${message._meta.messageId} to queue ${queue}`);
      
      this.emit('message:requeued', {
        queue,
        messageId: message._meta.messageId,
        retryCount: message._meta.retry.count
      });
    } catch (retryError) {
      logger.error(`Failed to requeue message ${message._meta.messageId}: ${retryError.message}`);
      
      // Send to dead letter queue
      await this.sendToDeadLetterQueue(message, queue, `Retry failed: ${retryError.message}`);
    }
  }
  
  /**
   * Send a message to the dead letter queue
   * 
   * @param {Object} message - Message to send
   * @param {string} sourceQueue - Queue the message was from
   * @param {string} reason - Reason for sending to DLQ
   */
  async sendToDeadLetterQueue(message, sourceQueue, reason) {
    try {
      // Add dead letter metadata
      const dlqMessage = {
        ...message,
        _dlq: {
          sourceQueue,
          reason,
          timestamp: Date.now(),
          originalMessageId: message._meta.messageId
        }
      };
      
      // Send to dead letter queue
      await this.kafkaService.sendMessage(
        this.getQueueName(this.config.deadLetterQueue),
        dlqMessage,
        message._meta.messageId,
        {
          'message-id': message._meta.messageId,
          'source-queue': sourceQueue,
          'reason': reason,
          'original-timestamp': `${message._meta.timestamp}`,
          'dlq-timestamp': `${Date.now()}`
        }
      );
      
      // Update metrics
      this.metrics.deadLetterCount++;
      
      logger.info(`Sent message ${message._meta.messageId} to dead letter queue (reason: ${reason})`);
      
      this.emit('message:dead-letter', {
        messageId: message._meta.messageId,
        sourceQueue,
        reason
      });
    } catch (error) {
      logger.error(`Failed to send message ${message._meta.messageId} to dead letter queue: ${error.message}`);
      
      this.emit('message:error', {
        queue: this.config.deadLetterQueue,
        messageId: message._meta.messageId,
        error: error.message
      });
    }
  }
  
  /**
   * Create a request-response pattern
   * 
   * @param {string} serviceName - Name of the service
   * @returns {Object} Request-response interface
   */
  async createRequestResponse(serviceName) {
    if (!(await this.kafkaService.checkHealth()).connected) {
      await this.connect();
    }
    
    // Create a request-response using the Kafka service
    const rrService = await this.kafkaService.createRequestResponse(serviceName);
    
    // Keep track of the handler for cleanup
    this.requestHandlers.set(serviceName, rrService);
    
    logger.info(`Created request-response service: ${serviceName}`);
    
    return {
      serviceName,
      async request(payload, options = {}) {
        try {
          const result = await rrService.request(payload, options);
          
          return result;
        } catch (error) {
          logger.error(`Error in request to ${serviceName}: ${error.message}`);
          throw error;
        }
      },
      async handleRequests(handler, options = {}) {
        return await rrService.handleRequests(
          async (payload, message) => {
            try {
              return await handler(payload, {
                messageId: message.headers.requestId,
                timestamp: parseInt(message.headers.timestamp, 10) || Date.now(),
                headers: message.headers
              });
            } catch (error) {
              logger.error(`Error handling request for ${serviceName}: ${error.message}`);
              throw error;
            }
          },
          options
        );
      },
      async close() {
        await rrService.close();
        this.requestHandlers.delete(serviceName);
      }
    };
  }
  
  /**
   * Create a broadcast channel for one-to-many communication
   * 
   * @param {string} channelName - Name of the channel
   * @returns {Object} Broadcast channel interface
   */
  async createBroadcastChannel(channelName) {
    if (!(await this.kafkaService.checkHealth()).connected) {
      await this.connect();
    }
    
    // Use the PubSub pattern from Kafka
    const pubSub = await this.kafkaService.createPubSub(channelName);
    
    logger.info(`Created broadcast channel: ${channelName}`);
    
    return {
      channelName,
      async broadcast(message, options = {}) {
        try {
          await pubSub.publish(message, {
            timestamp: `${Date.now()}`,
            ...options
          });
          
          logger.debug(`Broadcast message to channel ${channelName}`);
          
          return true;
        } catch (error) {
          logger.error(`Error broadcasting to channel ${channelName}: ${error.message}`);
          throw error;
        }
      },
      async subscribe(subscriberId, messageHandler, options = {}) {
        const subscription = await pubSub.subscribe(
          subscriberId,
          async (message) => {
            try {
              await messageHandler(message.value, {
                messageId: message.key,
                timestamp: parseInt(message.headers.timestamp, 10) || Date.now(),
                headers: message.headers
              });
            } catch (error) {
              logger.error(`Error in broadcast handler for ${channelName}: ${error.message}`);
              // Don't re-throw - we don't want to break the subscription
            }
          },
          options
        );
        
        return {
          channelName,
          subscriberId,
          async unsubscribe() {
            await subscription.unsubscribe();
          }
        };
      }
    };
  }
  
  /**
   * Get metrics about the message queue
   * 
   * @returns {Object} Current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      subscriptions: this.subscriptions.size,
      requestHandlers: this.requestHandlers.size,
      timestamp: Date.now()
    };
  }
  
  /**
   * Disconnect from the message queue
   */
  async disconnect() {
    try {
      logger.info('Disconnecting Message Queue...');
      
      // Unsubscribe from all subscriptions
      const subscriptionIds = Array.from(this.subscriptions.keys());
      
      for (const subscriptionId of subscriptionIds) {
        try {
          await this.unsubscribeFromQueue(subscriptionId);
        } catch (error) {
          logger.error(`Error unsubscribing from queue (${subscriptionId}): ${error.message}`);
        }
      }
      
      // Close all request handlers
      const serviceNames = Array.from(this.requestHandlers.keys());
      
      for (const serviceName of serviceNames) {
        try {
          const handler = this.requestHandlers.get(serviceName);
          await handler.close();
          this.requestHandlers.delete(serviceName);
        } catch (error) {
          logger.error(`Error closing request handler for ${serviceName}: ${error.message}`);
        }
      }
      
      // Disconnect from Kafka
      await this.kafkaService.disconnect();
      
      logger.info('Message Queue disconnected');
      this.emit('disconnected');
      
      return true;
    } catch (error) {
      logger.error(`Error disconnecting Message Queue: ${error.message}`);
      throw error;
    }
  }
}

module.exports = MessageQueue;
