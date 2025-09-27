const BaseAgent = require('../base-agent');
const { getModelClient } = require('../../models/model-orchestrator');
const VectorDb = require('../../core/memory/vector-db');
const KnowledgeBase = require('../../core/memory/knowledge-base');
const CodeEmbeddings = require('../../core/memory/code-embeddings');
const MessageQueue = require('../../core/communication/message-queue');
const logger = require('../../utils/logger');
const projectAnalyzer = require('../../utils/project-analyzer');
const { BACKEND_FRAMEWORKS, DATABASE_TYPES } = require('../../../config/default.json');

/**
 * BackendAgent class responsible for backend architecture, 
 * API design, database modeling, and server-side implementation
 */
class BackendAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      agentName: 'backend-agent',
      agentDescription: 'Responsible for backend architecture, API design, database modeling, and server-side implementation',
      defaultModel: 'gpt-4-turbo',
      ...config
    });
    
    this.vectorDb = new VectorDb();
    this.knowledgeBase = new KnowledgeBase();
    this.codeEmbeddings = new CodeEmbeddings();
    this.messageQueue = new MessageQueue();
    this.supportedFrameworks = BACKEND_FRAMEWORKS || [
      'express', 'fastapi', 'spring', 'django', 'laravel', 'dotnet', 'rails'
    ];
    this.supportedDatabases = DATABASE_TYPES || [
      'postgresql', 'mysql', 'mongodb', 'dynamodb', 'firebase', 'sqlserver', 'redis'
    ];
  }

  /**
   * Initialize the backend agent
   */
  async initialize() {
    await super.initialize();
    logger.info(`${this.agentName} initialized with models: ${this.modelClient.modelName}`);
    
    // Subscribe to relevant topics
    this.messageQueue.subscribe('planning.architecture_decided', this.handleArchitectureDecision.bind(this));
    this.messageQueue.subscribe('frontend.api_needs', this.handleApiNeeds.bind(this));
    this.messageQueue.subscribe('database.schema_updated', this.handleDatabaseSchemaUpdate.bind(this));
    
    // Load backend-specific knowledge
    await this.loadBackendKnowledge();
  }

  /**
   * Load backend-specific knowledge into memory systems
   */
  async loadBackendKnowledge() {
    try {
      // Load framework-specific knowledge
      for (const framework of this.supportedFrameworks) {
        await this.knowledgeBase.loadKnowledge(`backend.frameworks.${framework}`);
      }
      
      // Load database-specific knowledge
      for (const db of this.supportedDatabases) {
        await this.knowledgeBase.loadKnowledge(`backend.databases.${db}`);
      }
      
      // Load API design patterns
      await this.knowledgeBase.loadKnowledge('backend.api_design_patterns');
      
      // Load security best practices
      await this.knowledgeBase.loadKnowledge('backend.security_best_practices');
      
      logger.info(`${this.agentName} loaded backend knowledge successfully`);
    } catch (error) {
      logger.error(`Error loading backend knowledge: ${error.message}`);
      throw error;
    }
  }

  /**
   * Design backend architecture based on project requirements
   * @param {Object} projectRequirements - The project requirements
   * @returns {Object} The backend architecture design
   */
  async designBackendArchitecture(projectRequirements) {
    const prompt = this.createPrompt('design_backend_architecture', {
      projectRequirements,
      supportedFrameworks: this.supportedFrameworks,
      supportedDatabases: this.supportedDatabases
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const architecture = JSON.parse(response);
      
      // Store the architecture in the knowledge base
      await this.knowledgeBase.storeKnowledge('backend.current_architecture', architecture);
      
      // Notify other agents about the architecture decision
      await this.messageQueue.publish('backend.architecture_designed', { architecture });
      
      return architecture;
    } catch (error) {
      logger.error(`Error parsing backend architecture: ${error.message}`);
      throw new Error(`Failed to design backend architecture: ${error.message}`);
    }
  }

  /**
   * Create API specifications based on requirements
   * @param {Object} apiRequirements - The API requirements
   * @returns {Object} The API specifications
   */
  async createApiSpecs(apiRequirements) {
    const currentArchitecture = await this.knowledgeBase.retrieveKnowledge('backend.current_architecture');
    
    const prompt = this.createPrompt('create_api_specs', {
      apiRequirements,
      currentArchitecture,
      securityBestPractices: await this.knowledgeBase.retrieveKnowledge('backend.security_best_practices')
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const apiSpecs = JSON.parse(response);
      
      // Store the API specifications in the knowledge base
      await this.knowledgeBase.storeKnowledge('backend.api_specs', apiSpecs);
      
      // Notify other agents about the API specifications
      await this.messageQueue.publish('backend.api_specs_created', { apiSpecs });
      
      return apiSpecs;
    } catch (error) {
      logger.error(`Error parsing API specifications: ${error.message}`);
      throw new Error(`Failed to create API specifications: ${error.message}`);
    }
  }

  /**
   * Design database schema based on data requirements
   * @param {Object} dataRequirements - The data requirements
   * @returns {Object} The database schema
   */
  async designDatabaseSchema(dataRequirements) {
    const currentArchitecture = await this.knowledgeBase.retrieveKnowledge('backend.current_architecture');
    
    const prompt = this.createPrompt('design_database_schema', {
      dataRequirements,
      currentArchitecture,
      databaseType: currentArchitecture.database
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const dbSchema = JSON.parse(response);
      
      // Store the database schema in the knowledge base
      await this.knowledgeBase.storeKnowledge('backend.database_schema', dbSchema);
      
      // Notify other agents about the database schema
      await this.messageQueue.publish('backend.database_schema_designed', { dbSchema });
      
      return dbSchema;
    } catch (error) {
      logger.error(`Error parsing database schema: ${error.message}`);
      throw new Error(`Failed to design database schema: ${error.message}`);
    }
  }

  /**
   * Generate backend code based on architecture, API specs, and database schema
   * @param {Object} options - Code generation options
   * @returns {Object} The generated code files
   */
  async generateBackendCode(options = {}) {
    const architecture = await this.knowledgeBase.retrieveKnowledge('backend.current_architecture');
    const apiSpecs = await this.knowledgeBase.retrieveKnowledge('backend.api_specs');
    const dbSchema = await this.knowledgeBase.retrieveKnowledge('backend.database_schema');
    
    // Get the appropriate framework template
    const framework = architecture.framework || 'express';
    const frameworkKnowledge = await this.knowledgeBase.retrieveKnowledge(`backend.frameworks.${framework}`);
    
    const prompt = this.createPrompt('generate_backend_code', {
      architecture,
      apiSpecs,
      dbSchema,
      frameworkKnowledge,
      options
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const codeFiles = JSON.parse(response);
      
      // Store code embeddings for future reference
      for (const [filePath, code] of Object.entries(codeFiles)) {
        await this.codeEmbeddings.storeCodeEmbedding(filePath, code);
      }
      
      // Notify other agents about the generated code
      await this.messageQueue.publish('backend.code_generated', { codeFiles });
      
      return codeFiles;
    } catch (error) {
      logger.error(`Error parsing generated backend code: ${error.message}`);
      throw new Error(`Failed to generate backend code: ${error.message}`);
    }
  }

  /**
   * Implement authentication and authorization
   * @param {Object} securityRequirements - The security requirements
   * @returns {Object} The authentication and authorization implementation
   */
  async implementAuth(securityRequirements) {
    const architecture = await this.knowledgeBase.retrieveKnowledge('backend.current_architecture');
    const securityBestPractices = await this.knowledgeBase.retrieveKnowledge('backend.security_best_practices');
    
    const prompt = this.createPrompt('implement_auth', {
      securityRequirements,
      architecture,
      securityBestPractices
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const authImplementation = JSON.parse(response);
      
      // Store the auth implementation in the knowledge base
      await this.knowledgeBase.storeKnowledge('backend.auth_implementation', authImplementation);
      
      // Notify security agent about the auth implementation
      await this.messageQueue.publish('backend.auth_implemented', { authImplementation });
      
      return authImplementation;
    } catch (error) {
      logger.error(`Error parsing auth implementation: ${error.message}`);
      throw new Error(`Failed to implement authentication: ${error.message}`);
    }
  }

  /**
   * Create database migrations
   * @param {Object} schemaChanges - The schema changes
   * @returns {Object} The migration scripts
   */
  async createMigrations(schemaChanges) {
    const architecture = await this.knowledgeBase.retrieveKnowledge('backend.current_architecture');
    const currentSchema = await this.knowledgeBase.retrieveKnowledge('backend.database_schema');
    
    const prompt = this.createPrompt('create_migrations', {
      schemaChanges,
      currentSchema,
      databaseType: architecture.database
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const migrations = JSON.parse(response);
      
      // Store the migrations in the knowledge base
      await this.knowledgeBase.storeKnowledge('backend.migrations', migrations);
      
      // Notify DevOps agent about the migrations
      await this.messageQueue.publish('backend.migrations_created', { migrations });
      
      return migrations;
    } catch (error) {
      logger.error(`Error parsing migrations: ${error.message}`);
      throw new Error(`Failed to create migrations: ${error.message}`);
    }
  }

  /**
   * Handle architecture decision events
   * @param {Object} message - The message containing architecture decisions
   */
  async handleArchitectureDecision(message) {
    logger.info(`${this.agentName} received architecture decision: ${JSON.stringify(message)}`);
    
    // Extract backend-relevant architecture decisions
    const { backend_framework, database_type, api_style } = message;
    
    // Create backend architecture based on decisions
    const backendArchitecture = {
      framework: backend_framework,
      database: database_type,
      apiStyle: api_style
    };
    
    // Store in knowledge base
    await this.knowledgeBase.storeKnowledge('backend.current_architecture', backendArchitecture);
    
    // Begin designing API based on the architecture
    if (message.api_requirements) {
      await this.createApiSpecs(message.api_requirements);
    }
  }

  /**
   * Handle API needs from frontend agent
   * @param {Object} message - The message containing API needs
   */
  async handleApiNeeds(message) {
    logger.info(`${this.agentName} received API needs from frontend: ${JSON.stringify(message)}`);
    
    // Get current API specs
    const currentApiSpecs = await this.knowledgeBase.retrieveKnowledge('backend.api_specs') || { endpoints: [] };
    
    // Add or update endpoints based on frontend needs
    for (const endpoint of message.endpoints) {
      const existingEndpointIndex = currentApiSpecs.endpoints.findIndex(e => e.path === endpoint.path && e.method === endpoint.method);
      
      if (existingEndpointIndex >= 0) {
        currentApiSpecs.endpoints[existingEndpointIndex] = {
          ...currentApiSpecs.endpoints[existingEndpointIndex],
          ...endpoint
        };
      } else {
        currentApiSpecs.endpoints.push(endpoint);
      }
    }
    
    // Update API specs in knowledge base
    await this.knowledgeBase.storeKnowledge('backend.api_specs', currentApiSpecs);
    
    // Generate or update API implementations
    await this.generateApiImplementations(message.endpoints);
    
    // Notify frontend that API needs are being addressed
    await this.messageQueue.publish('backend.api_needs_addressed', {
      endpoints: message.endpoints,
      status: 'in_progress'
    });
  }

  /**
   * Generate API implementations for specific endpoints
   * @param {Array} endpoints - The endpoints to implement
   * @returns {Object} The API implementations
   */
  async generateApiImplementations(endpoints) {
    const architecture = await this.knowledgeBase.retrieveKnowledge('backend.current_architecture');
    const dbSchema = await this.knowledgeBase.retrieveKnowledge('backend.database_schema');
    
    const prompt = this.createPrompt('generate_api_implementations', {
      endpoints,
      architecture,
      dbSchema
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const implementations = JSON.parse(response);
      
      // Store code embeddings
      for (const [endpointPath, implementation] of Object.entries(implementations)) {
        await this.codeEmbeddings.storeCodeEmbedding(`api.${endpointPath}`, implementation);
      }
      
      // Update knowledge base with implementations
      const apiImplementations = await this.knowledgeBase.retrieveKnowledge('backend.api_implementations') || {};
      await this.knowledgeBase.storeKnowledge('backend.api_implementations', {
        ...apiImplementations,
        ...implementations
      });
      
      // Notify frontend that API implementations are ready
      await this.messageQueue.publish('backend.api_implemented', {
        endpoints,
        implementations
      });
      
      return implementations;
    } catch (error) {
      logger.error(`Error parsing API implementations: ${error.message}`);
      throw new Error(`Failed to generate API implementations: ${error.message}`);
    }
  }

  /**
   * Handle database schema updates
   * @param {Object} message - The message containing schema updates
   */
  async handleDatabaseSchemaUpdate(message) {
    logger.info(`${this.agentName} received database schema update: ${JSON.stringify(message)}`);
    
    // Get current schema
    const currentSchema = await this.knowledgeBase.retrieveKnowledge('backend.database_schema') || { entities: [] };
    
    // Create migrations if needed
    if (currentSchema.entities.length > 0) {
      await this.createMigrations({
        currentSchema,
        newSchema: message.schema
      });
    }
    
    // Update schema in knowledge base
    await this.knowledgeBase.storeKnowledge('backend.database_schema', message.schema);
    
    // Update API implementations to reflect schema changes
    const apiSpecs = await this.knowledgeBase.retrieveKnowledge('backend.api_specs');
    if (apiSpecs && apiSpecs.endpoints) {
      await this.generateApiImplementations(apiSpecs.endpoints);
    }
  }

  /**
   * Create a prompt for the model with appropriate context
   * @param {String} promptType - The type of prompt to create
   * @param {Object} contextData - The context data for the prompt
   * @returns {String} The complete prompt
   */
  createPrompt(promptType, contextData) {
    const basePrompt = `You are an expert backend developer AI agent. Your task is to ${this.getPromptInstructionsByType(promptType)}.
    
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
      design_backend_architecture: 'design a backend architecture based on project requirements',
      create_api_specs: 'create API specifications based on requirements',
      design_database_schema: 'design a database schema based on data requirements',
      generate_backend_code: 'generate backend code based on architecture, API specs, and database schema',
      implement_auth: 'implement authentication and authorization based on security requirements',
      create_migrations: 'create database migrations based on schema changes',
      generate_api_implementations: 'generate API implementations for specific endpoints'
    };
    
    return instructionMap[promptType] || 'perform a backend development task';
  }
}

module.exports = BackendAgent;
