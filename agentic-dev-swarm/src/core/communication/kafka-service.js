/**
 * Kafka Service for the Agentic Software Development Swarm
 * 
 * This module provides a Kafka-based messaging system for inter-agent communication.
 */

const { Kafka } = require('kafkajs');
const EventEmitter = require('events');
const logger = require('../../utils/logger');

class KafkaService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      bootstrapServers: config.bootstrapServers || 'localhost:9092',
      clientId: config.clientId || 'agentic-swarm',
      groupId: config.groupId || 'swarm-agents',
      connectionTimeout: config.connectionTimeout || 10000,
      requestTimeout: config.requestTimeout || 30000,
      retryCount: config.retryCount || 5,
      retryDelay: config.retryDelay || 500,
      topicPrefix: config.topicPrefix || 'swarm',
      defaultPartitions: config.defaultPartitions || 1,
      defaultReplicationFactor: config.defaultReplicationFactor || 1
    };
    
    this.kafka = null;
    this.producer = null;
    this.consumers = new Map();
    this.adminClient = null;
    this.isConnected = false;
    this.isProducerConnected = false;
    this.topicCache = new Set();
    
    logger.info('Kafka Service initialized');
    logger.debug(`Kafka Service configuration: ${JSON.stringify(this.config)}`);
  }
  
  /**
   * Connect to Kafka and initialize producer
   */
  async connect() {
    try {
      if (this.isConnected) {
        logger.debug('Already connected to Kafka');
        return;
      }
      
      logger.info(`Connecting to Kafka at ${this.config.bootstrapServers}`);
      
      // Initialize Kafka client
      this.kafka = new Kafka({
        clientId: this.config.clientId,
        brokers: this.config.bootstrapServers.split(','),
        connectionTimeout: this.config.connectionTimeout,
        requestTimeout: this.config.requestTimeout,
        retry: {
          initialRetryTime: this.config.retryDelay,
          retries: this.config.retryCount
        }
      });
      
      // Initialize admin client
      this.adminClient = this.kafka.admin();
      await this.adminClient.connect();
      
      // Initialize producer
      this.producer = this.kafka.producer({
        allowAutoTopicCreation: true,
        transactionTimeout: 30000
      });
      
      await this.producer.connect();
      this.isProducerConnected = true;
      this.isConnected = true;
      
      // Cache existing topics
      await this.loadTopicCache();
      
      logger.info('Successfully connected to Kafka');
      this.emit('connected');
      
      return true;
    } catch (error) {
      logger.error(`Failed to connect to Kafka: ${error.message}`);
      this.isConnected = false;
      this.isProducerConnected = false;
      
      this.emit('error', error);
      
      throw error;
    }
  }
  
  /**
   * Load existing topics into the cache
   */
  async loadTopicCache() {
    try {
      const { topics } = await this.adminClient.listTopics();
      this.topicCache = new Set(topics);
      
      logger.debug(`Loaded ${topics.length} topics into cache`);
    } catch (error) {
      logger.error(`Failed to load topic cache: ${error.message}`);
      // Initialize with empty cache instead
      this.topicCache = new Set();
    }
  }
  
  /**
   * Create a new Kafka topic if it doesn't exist
   * 
   * @param {string} topic - Topic name
   * @param {number} partitions - Number of partitions
   * @param {number} replicationFactor - Replication factor
   */
  async createTopic(topic, partitions = null, replicationFactor = null) {
    try {
      // Check if topic already exists
      if (this.topicCache.has(topic)) {
        logger.debug(`Topic ${topic} already exists`);
        return true;
      }
      
      // Create the topic
      await this.adminClient.createTopics({
        topics: [{
          topic,
          numPartitions: partitions || this.config.defaultPartitions,
          replicationFactor: replicationFactor || this.config.defaultReplicationFactor
        }]
      });
      
      this.topicCache.add(topic);
      
      logger.info(`Created Kafka topic: ${topic}`);
      return true;
    } catch (error) {
      logger.error(`Failed to create topic ${topic}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Format a topic name with the configured prefix
   * 
   * @param {string} topicName - Base topic name
   * @returns {string} Formatted topic name
   */
  formatTopic(topicName) {
    return `${this.config.topicPrefix}-${topicName}`;
  }
  
  /**
   * Send a message to a Kafka topic
   * 
   * @param {string} topic - Topic to send to
   * @param {Object} message - Message to send
   * @param {string} key - Optional message key
   * @param {Object} headers - Optional headers
   * @returns {Object} Result of the send operation
   */
  async sendMessage(topic, message, key = null, headers = {}) {
    if (!this.isConnected || !this.isProducerConnected) {
      await this.connect();
    }
    
    const formattedTopic = this.formatTopic(topic);
    
    // Ensure topic exists
    if (!this.topicCache.has(formattedTopic)) {
      await this.createTopic(formattedTopic);
    }
    
    // Prepare message
    const messageValue = typeof message === 'string' ? message : JSON.stringify(message);
    const messageKey = key ? key : `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    
    // Add timestamp header
    const messageHeaders = {
      timestamp: `${Date.now()}`,
      ...headers
    };
    
    try {
      // Send message
      const result = await this.producer.send({
        topic: formattedTopic,
        messages: [
          {
            key: messageKey,
            value: messageValue,
            headers: messageHeaders
          }
        ]
      });
      
      logger.debug(`Sent message to topic ${formattedTopic} (partition: ${result[0].partition}, offset: ${result[0].offset})`);
      
      this.emit('message:sent', {
        topic: formattedTopic,
        messageKey,
        partition: result[0].partition,
        offset: result[0].offset
      });
      
      return {
        success: true,
        topic: formattedTopic,
        key: messageKey,
        partition: result[0].partition,
        offset: result[0].offset
      };
    } catch (error) {
      logger.error(`Failed to send message to topic ${formattedTopic}: ${error.message}`);
      
      this.emit('message:error', {
        topic: formattedTopic,
        messageKey,
        error: error.message
      });
      
      throw error;
    }
  }
  
  /**
   * Subscribe to a Kafka topic
   * 
   * @param {string} topic - Topic to subscribe to
   * @param {Function} messageHandler - Function to handle received messages
   * @param {Object} options - Consumer options
   * @returns {Object} Subscription handle
   */
  async subscribe(topic, messageHandler, options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const formattedTopic = this.formatTopic(topic);
    
    // Ensure topic exists
    if (!this.topicCache.has(formattedTopic)) {
      await this.createTopic(formattedTopic);
    }
    
    // Create a unique consumer group ID if not provided
    const groupId = options.groupId || 
      `${this.config.groupId}-${topic}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    
    // Create consumer
    const consumer = this.kafka.consumer({
      groupId,
      ...options
    });
    
    try {
      await consumer.connect();
      await consumer.subscribe({ 
        topic: formattedTopic, 
        fromBeginning: options.fromBeginning || false 
      });
      
      // Start consuming
      await consumer.run({
        partitionsConsumedConcurrently: options.concurrentPartitions || 1,
        eachMessage: async ({ topic, partition, message, heartbeat }) => {
          try {
            const key = message.key ? message.key.toString() : null;
            const headers = {};
            
            // Convert Buffer headers to strings
            for (const [headerKey, headerValue] of Object.entries(message.headers || {})) {
              headers[headerKey] = headerValue.toString();
            }
            
            // Parse message value
            let value;
            try {
              value = JSON.parse(message.value.toString());
            } catch (e) {
              // If not JSON, return as string
              value = message.value.toString();
            }
            
            // Create message object
            const messageObject = {
              topic,
              partition,
              offset: message.offset,
              key,
              value,
              headers,
              timestamp: message.timestamp
            };
            
            logger.debug(`Received message from topic ${topic} (partition: ${partition}, offset: ${message.offset})`);
            
            // Call the message handler
            await messageHandler(messageObject);
            
            // Emit message received event
            this.emit('message:received', {
              topic,
              key,
              partition,
              offset: message.offset
            });
            
            // Optionally call heartbeat to manually commit offsets
            if (options.manualHeartbeat) {
              await heartbeat();
            }
          } catch (error) {
            logger.error(`Error processing message from topic ${topic}: ${error.message}`);
            
            this.emit('message:error', {
              topic,
              error: error.message
            });
            
            // Decide whether to rethrow based on options
            if (options.fatalErrors) {
              throw error;
            }
          }
        }
      });
      
      // Store consumer
      const consumerId = `${formattedTopic}-${groupId}`;
      this.consumers.set(consumerId, consumer);
      
      logger.info(`Subscribed to topic ${formattedTopic} with group ID ${groupId}`);
      
      this.emit('topic:subscribed', {
        topic: formattedTopic,
        groupId
      });
      
      // Return subscription handle
      return {
        topic: formattedTopic,
        groupId,
        consumerId,
        async unsubscribe() {
          await this.unsubscribeConsumer(consumerId);
        }
      };
    } catch (error) {
      logger.error(`Failed to subscribe to topic ${formattedTopic}: ${error.message}`);
      
      // Clean up consumer if we got an error
      try {
        await consumer.disconnect();
      } catch (disconnectError) {
        logger.error(`Error disconnecting consumer: ${disconnectError.message}`);
      }
      
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Unsubscribe a consumer from a topic
   * 
   * @param {string} consumerId - ID of the consumer to unsubscribe
   * @returns {boolean} True if successful
   */
  async unsubscribeConsumer(consumerId) {
    const consumer = this.consumers.get(consumerId);
    
    if (!consumer) {
      logger.warn(`No consumer found with ID ${consumerId}`);
      return false;
    }
    
    try {
      await consumer.disconnect();
      this.consumers.delete(consumerId);
      
      logger.info(`Unsubscribed consumer ${consumerId}`);
      
      this.emit('topic:unsubscribed', {
        consumerId
      });
      
      return true;
    } catch (error) {
      logger.error(`Failed to unsubscribe consumer ${consumerId}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Create a consumer group for load-balanced message consumption
   * 
   * @param {string} topic - Topic to consume from
   * @param {string} groupId - Consumer group ID
   * @param {Function} messageHandler - Function to handle received messages
   * @param {Object} options - Consumer options
   * @returns {Object} Consumer group handle
   */
  async createConsumerGroup(topic, groupId, messageHandler, options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const formattedTopic = this.formatTopic(topic);
    
    // Ensure topic exists
    if (!this.topicCache.has(formattedTopic)) {
      await this.createTopic(formattedTopic);
    }
    
    // Create consumer
    const consumer = this.kafka.consumer({
      groupId,
      ...options
    });
    
    try {
      await consumer.connect();
      await consumer.subscribe({ 
        topic: formattedTopic, 
        fromBeginning: options.fromBeginning || false 
      });
      
      // Start consuming
      await consumer.run({
        partitionsConsumedConcurrently: options.concurrentPartitions || 1,
        eachMessage: async ({ topic, partition, message, heartbeat }) => {
          try {
            // Handle message as in subscribe method
            const key = message.key ? message.key.toString() : null;
            const headers = {};
            
            for (const [headerKey, headerValue] of Object.entries(message.headers || {})) {
              headers[headerKey] = headerValue.toString();
            }
            
            let value;
            try {
              value = JSON.parse(message.value.toString());
            } catch (e) {
              value = message.value.toString();
            }
            
            const messageObject = {
              topic,
              partition,
              offset: message.offset,
              key,
              value,
              headers,
              timestamp: message.timestamp,
              groupId // Include group ID in message object
            };
            
            logger.debug(`Group ${groupId} received message from topic ${topic} (partition: ${partition}, offset: ${message.offset})`);
            
            await messageHandler(messageObject);
            
            this.emit('group:message-received', {
              topic,
              key,
              partition,
              offset: message.offset,
              groupId
            });
            
            if (options.manualHeartbeat) {
              await heartbeat();
            }
          } catch (error) {
            logger.error(`Error processing message in group ${groupId}: ${error.message}`);
            
            this.emit('group:message-error', {
              topic,
              error: error.message,
              groupId
            });
            
            if (options.fatalErrors) {
              throw error;
            }
          }
        }
      });
      
      // Store consumer
      const consumerId = `group-${formattedTopic}-${groupId}`;
      this.consumers.set(consumerId, consumer);
      
      logger.info(`Created consumer group ${groupId} for topic ${formattedTopic}`);
      
      this.emit('group:created', {
        topic: formattedTopic,
        groupId
      });
      
      // Return group handle
      return {
        topic: formattedTopic,
        groupId,
        consumerId,
        async shutdown() {
          await this.shutdownConsumerGroup(consumerId);
        }
      };
    } catch (error) {
      logger.error(`Failed to create consumer group ${groupId}: ${error.message}`);
      
      try {
        await consumer.disconnect();
      } catch (disconnectError) {
        logger.error(`Error disconnecting consumer group: ${disconnectError.message}`);
      }
      
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Shutdown a consumer group
   * 
   * @param {string} consumerId - ID of the consumer group
   * @returns {boolean} True if successful
   */
  async shutdownConsumerGroup(consumerId) {
    return await this.unsubscribeConsumer(consumerId);
  }
  
  /**
   * Create a pub/sub pattern for broadcast messaging
   * 
   * @param {string} channel - Channel name
   * @returns {Object} PubSub interface
   */
  async createPubSub(channel) {
    const pubSubTopic = `pubsub-${channel}`;
    
    // Create the publish function
    const publish = async (message, headers = {}) => {
      return await this.sendMessage(pubSubTopic, message, null, headers);
    };
    
    // Create the subscribe function
    const subscribe = async (subscriberId, messageHandler, options = {}) => {
      // Generate a unique group ID for this subscriber
      const groupId = `${this.config.groupId}-${channel}-${subscriberId}`;
      
      // Subscribe with the unique group ID
      const subscription = await this.subscribe(
        pubSubTopic, 
        messageHandler, 
        { groupId, fromBeginning: false, ...options }
      );
      
      return {
        channel,
        subscriberId,
        async unsubscribe() {
          await subscription.unsubscribe();
        }
      };
    };
    
    logger.info(`Created PubSub for channel ${channel}`);
    
    // Return the PubSub interface
    return {
      channel,
      publish,
      subscribe
    };
  }
  
  /**
   * Create a request-response pattern
   * 
   * @param {string} serviceName - Name of the service
   * @returns {Object} Request-response interface
   */
  async createRequestResponse(serviceName) {
    const requestTopic = `rr-req-${serviceName}`;
    const responseTopic = `rr-res-${serviceName}`;
    
    // Mapping of request IDs to response handlers
    const pendingRequests = new Map();
    
    // Create response consumer if needed
    let responseConsumer = null;
    
    const ensureResponseConsumer = async () => {
      if (responseConsumer) return;
      
      // Create a consumer for responses
      const subscription = await this.subscribe(
        responseTopic,
        async (message) => {
          const requestId = message.headers.requestId;
          
          if (!requestId) {
            logger.warn(`Received response without requestId for service ${serviceName}`);
            return;
          }
          
          const handler = pendingRequests.get(requestId);
          
          if (handler) {
            // Call the response handler
            handler.resolve(message.value);
            
            // Clean up
            pendingRequests.delete(requestId);
            
            // Clean up timeout
            clearTimeout(handler.timeout);
          } else {
            logger.warn(`Received response for unknown request ID: ${requestId}`);
          }
        },
        { groupId: `${this.config.groupId}-rr-client-${serviceName}` }
      );
      
      responseConsumer = subscription;
    };
    
    // Create the request function
    const request = async (payload, options = {}) => {
      // Ensure response consumer is set up
      await ensureResponseConsumer();
      
      // Generate a unique request ID
      const requestId = `req-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      
      // Create a promise that will be resolved with the response
      const responsePromise = new Promise((resolve, reject) => {
        // Set up timeout if needed
        const timeout = options.timeout ? setTimeout(() => {
          pendingRequests.delete(requestId);
          reject(new Error(`Request to ${serviceName} timed out after ${options.timeout}ms`));
        }, options.timeout) : null;
        
        // Store the handlers
        pendingRequests.set(requestId, {
          resolve,
          reject,
          timeout,
          timestamp: Date.now()
        });
      });
      
      // Send the request
      await this.sendMessage(
        requestTopic,
        payload,
        requestId,
        { requestId, ...options.headers }
      );
      
      // Return the response promise
      return responsePromise;
    };
    
    // Function to handle requests (for servers)
    const handleRequests = async (handler, options = {}) => {
      // Create a consumer for requests
      const subscription = await this.subscribe(
        requestTopic,
        async (message) => {
          const requestId = message.headers.requestId;
          
          if (!requestId) {
            logger.warn(`Received request without requestId for service ${serviceName}`);
            return;
          }
          
          try {
            // Call the handler
            const response = await handler(message.value, message);
            
            // Send the response
            await this.sendMessage(
              responseTopic,
              response,
              requestId,
              { requestId, ...options.responseHeaders }
            );
          } catch (error) {
            logger.error(`Error handling request for service ${serviceName}: ${error.message}`);
            
            // Send error response
            await this.sendMessage(
              responseTopic,
              { error: true, message: error.message },
              requestId,
              { requestId, error: 'true' }
            );
          }
        },
        { groupId: `${this.config.groupId}-rr-server-${serviceName}`, ...options }
      );
      
      logger.info(`Started request handler for service ${serviceName}`);
      
      return {
        serviceName,
        async stop() {
          await subscription.unsubscribe();
        }
      };
    };
    
    logger.info(`Created RequestResponse for service ${serviceName}`);
    
    // Return the request-response interface
    return {
      serviceName,
      request,
      handleRequests,
      async close() {
        if (responseConsumer) {
          await responseConsumer.unsubscribe();
          responseConsumer = null;
        }
        
        // Clear any pending requests
        for (const [requestId, handler] of pendingRequests.entries()) {
          clearTimeout(handler.timeout);
          handler.reject(new Error('Request-response client closed'));
          pendingRequests.delete(requestId);
        }
      }
    };
  }
  
  /**
   * Send a batch of messages to a topic
   * 
   * @param {string} topic - Topic to send to
   * @param {Array} messages - Array of messages to send
   * @returns {Object} Result of the batch send
   */
  async sendBatch(topic, messages) {
    if (!this.isConnected || !this.isProducerConnected) {
      await this.connect();
    }
    
    const formattedTopic = this.formatTopic(topic);
    
    // Ensure topic exists
    if (!this.topicCache.has(formattedTopic)) {
      await this.createTopic(formattedTopic);
    }
    
    // Format messages
    const kafkaMessages = messages.map(msg => {
      // Each message can be an object with { value, key, headers }
      // or just a value
      const message = typeof msg === 'object' && !Array.isArray(msg) ? msg : { value: msg };
      
      return {
        key: message.key ? message.key : `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        value: typeof message.value === 'string' ? message.value : JSON.stringify(message.value),
        headers: {
          timestamp: `${Date.now()}`,
          ...(message.headers || {})
        }
      };
    });
    
    try {
      // Send batch
      const result = await this.producer.send({
        topic: formattedTopic,
        messages: kafkaMessages
      });
      
      logger.debug(`Sent batch of ${messages.length} messages to topic ${formattedTopic}`);
      
      this.emit('batch:sent', {
        topic: formattedTopic,
        count: messages.length,
        result
      });
      
      return {
        success: true,
        topic: formattedTopic,
        count: messages.length,
        result
      };
    } catch (error) {
      logger.error(`Failed to send batch to topic ${formattedTopic}: ${error.message}`);
      
      this.emit('batch:error', {
        topic: formattedTopic,
        count: messages.length,
        error: error.message
      });
      
      throw error;
    }
  }
  
  /**
   * Get a list of available topics
   * 
   * @returns {Array} List of topics
   */
  async listTopics() {
    if (!this.isConnected) {
      await this.connect();
    }
    
    try {
      const { topics } = await this.adminClient.listTopics();
      
      // Filter to only include our prefixed topics
      const swarmTopics = topics.filter(topic => 
        topic.startsWith(`${this.config.topicPrefix}-`)
      );
      
      // Update topic cache
      this.topicCache = new Set(topics);
      
      logger.debug(`Listed ${swarmTopics.length} swarm topics`);
      
      return swarmTopics;
    } catch (error) {
      logger.error(`Failed to list topics: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Close all connections
   */
  async disconnect() {
    try {
      logger.info('Disconnecting Kafka service...');
      
      // Disconnect all consumers
      const consumerPromises = [];
      for (const [consumerId, consumer] of this.consumers.entries()) {
        consumerPromises.push(
          consumer.disconnect()
            .catch(error => {
              logger.error(`Error disconnecting consumer ${consumerId}: ${error.message}`);
            })
        );
      }
      
      await Promise.all(consumerPromises);
      this.consumers.clear();
      
      // Disconnect producer
      if (this.producer) {
        await this.producer.disconnect();
        this.isProducerConnected = false;
      }
      
      // Disconnect admin client
      if (this.adminClient) {
        await this.adminClient.disconnect();
      }
      
      this.isConnected = false;
      
      logger.info('Kafka service disconnected');
      this.emit('disconnected');
      
      return true;
    } catch (error) {
      logger.error(`Error disconnecting from Kafka: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get consumer group information
   * 
   * @param {string} groupId - Group ID to get info for
   * @returns {Object} Consumer group information
   */
  async getConsumerGroupInfo(groupId) {
    if (!this.isConnected) {
      await this.connect();
    }
    
    try {
      const groups = await this.adminClient.describeGroups([groupId]);
      
      if (!groups.groups || groups.groups.length === 0) {
        return null;
      }
      
      return groups.groups[0];
    } catch (error) {
      logger.error(`Failed to get consumer group info for ${groupId}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * List all consumer groups
   * 
   * @returns {Array} List of consumer groups
   */
  async listConsumerGroups() {
    if (!this.isConnected) {
      await this.connect();
    }
    
    try {
      const { groups } = await this.adminClient.listGroups();
      
      // Filter to only include our groups
      const swarmGroups = groups.filter(group => 
        group.groupId.startsWith(this.config.groupId)
      );
      
      logger.debug(`Listed ${swarmGroups.length} consumer groups`);
      
      return swarmGroups;
    } catch (error) {
      logger.error(`Failed to list consumer groups: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Check health status of the Kafka connection
   * 
   * @returns {Object} Health status
   */
  async checkHealth() {
    try {
      if (!this.isConnected) {
        return {
          status: 'disconnected',
          connected: false,
          producer: false,
          consumers: 0
        };
      }
      
      // Try to list topics as a connectivity test
      await this.adminClient.listTopics();
      
      return {
        status: 'connected',
        connected: true,
        producer: this.isProducerConnected,
        consumers: this.consumers.size
      };
    } catch (error) {
      logger.error(`Kafka health check failed: ${error.message}`);
      
      return {
        status: 'error',
        connected: false,
        error: error.message,
        producer: false,
        consumers: 0
      };
    }
  }
}

module.exports = KafkaService;
