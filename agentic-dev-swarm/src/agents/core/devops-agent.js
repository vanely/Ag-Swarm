const BaseAgent = require('../base-agent');
const { getModelClient } = require('../../models/model-orchestrator');
const VectorDb = require('../../core/memory/vector-db');
const KnowledgeBase = require('../../core/memory/knowledge-base');
const MessageQueue = require('../../core/communication/message-queue');
const logger = require('../../utils/logger');
const { CLOUD_PROVIDERS, CI_CD_TOOLS } = require('../../../config/default.json');

/**
 * DevOpsAgent class responsible for infrastructure, CI/CD pipelines, 
 * deployment, monitoring, and scaling infrastructure
 */
class DevOpsAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      agentName: 'devops-agent',
      agentDescription: 'Responsible for infrastructure, CI/CD pipelines, deployment, monitoring, and scaling',
      defaultModel: 'gpt-4-turbo',
      ...config
    });
    
    this.vectorDb = new VectorDb();
    this.knowledgeBase = new KnowledgeBase();
    this.messageQueue = new MessageQueue();
    
    this.supportedCloudProviders = CLOUD_PROVIDERS || [
      'aws', 'azure', 'gcp', 'digitalocean', 'heroku', 'vercel', 'netlify'
    ];
    
    this.supportedCiCdTools = CI_CD_TOOLS || [
      'github-actions', 'gitlab-ci', 'jenkins', 'circleci', 'travisci', 'azure-pipelines'
    ];
  }

  /**
   * Initialize the DevOps agent
   */
  async initialize() {
    await super.initialize();
    logger.info(`${this.agentName} initialized with models: ${this.modelClient.modelName}`);
    
    // Subscribe to relevant topics
    this.messageQueue.subscribe('planning.architecture_decided', this.handleArchitectureDecision.bind(this));
    this.messageQueue.subscribe('backend.code_generated', this.handleBackendCodeGenerated.bind(this));
    this.messageQueue.subscribe('frontend.code_generated', this.handleFrontendCodeGenerated.bind(this));
    this.messageQueue.subscribe('integration.ready_for_deployment', this.handleDeploymentRequest.bind(this));
    this.messageQueue.subscribe('backend.migrations_created', this.handleMigrationsCreated.bind(this));
    
    // Load DevOps-specific knowledge
    await this.loadDevOpsKnowledge();
  }

  /**
   * Load DevOps-specific knowledge into memory systems
   */
  async loadDevOpsKnowledge() {
    try {
      // Load cloud provider-specific knowledge
      for (const provider of this.supportedCloudProviders) {
        await this.knowledgeBase.loadKnowledge(`devops.cloud_providers.${provider}`);
      }
      
      // Load CI/CD tool-specific knowledge
      for (const tool of this.supportedCiCdTools) {
        await this.knowledgeBase.loadKnowledge(`devops.cicd_tools.${tool}`);
      }
      
      // Load infrastructure as code knowledge
      await this.knowledgeBase.loadKnowledge('devops.infrastructure_as_code');
      
      // Load containerization knowledge
      await this.knowledgeBase.loadKnowledge('devops.containerization');
      
      // Load monitoring knowledge
      await this.knowledgeBase.loadKnowledge('devops.monitoring');
      
      logger.info(`${this.agentName} loaded DevOps knowledge successfully`);
    } catch (error) {
      logger.error(`Error loading DevOps knowledge: ${error.message}`);
      throw error;
    }
  }

  /**
   * Design infrastructure based on project requirements
   * @param {Object} projectRequirements - The project requirements
   * @returns {Object} The infrastructure design
   */
  async designInfrastructure(projectRequirements) {
    const prompt = this.createPrompt('design_infrastructure', {
      projectRequirements,
      supportedCloudProviders: this.supportedCloudProviders
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const infrastructure = JSON.parse(response);
      
      // Store the infrastructure design in the knowledge base
      await this.knowledgeBase.storeKnowledge('devops.infrastructure_design', infrastructure);
      
      // Notify other agents about the infrastructure design
      await this.messageQueue.publish('devops.infrastructure_designed', { infrastructure });
      
      return infrastructure;
    } catch (error) {
      logger.error(`Error parsing infrastructure design: ${error.message}`);
      throw new Error(`Failed to design infrastructure: ${error.message}`);
    }
  }

  /**
   * Create Infrastructure as Code (IaC) configuration
   * @param {Object} infrastructureDesign - The infrastructure design
   * @returns {Object} The IaC configuration files
   */
  async createInfrastructureAsCode(infrastructureDesign) {
    const prompt = this.createPrompt('create_infrastructure_as_code', {
      infrastructureDesign,
      cloudProvider: infrastructureDesign.cloudProvider
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const iacFiles = JSON.parse(response);
      
      // Store the IaC files in the knowledge base
      await this.knowledgeBase.storeKnowledge('devops.infrastructure_as_code_files', iacFiles);
      
      // Notify other agents about the IaC files
      await this.messageQueue.publish('devops.infrastructure_as_code_created', { iacFiles });
      
      return iacFiles;
    } catch (error) {
      logger.error(`Error parsing Infrastructure as Code: ${error.message}`);
      throw new Error(`Failed to create Infrastructure as Code: ${error.message}`);
    }
  }

  /**
   * Setup CI/CD pipelines for the project
   * @param {Object} options - The CI/CD options
   * @returns {Object} The CI/CD configuration files
   */
  async setupCiCdPipelines(options) {
    const infrastructureDesign = await this.knowledgeBase.retrieveKnowledge('devops.infrastructure_design');
    const prompt = this.createPrompt('setup_cicd_pipelines', {
      options,
      infrastructureDesign,
      cicdTool: options.cicdTool || this.supportedCiCdTools[0]
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const cicdConfigs = JSON.parse(response);
      
      // Store the CI/CD configurations in the knowledge base
      await this.knowledgeBase.storeKnowledge('devops.cicd_configurations', cicdConfigs);
      
      // Notify other agents about the CI/CD configurations
      await this.messageQueue.publish('devops.cicd_setup_complete', { cicdConfigs });
      
      return cicdConfigs;
    } catch (error) {
      logger.error(`Error parsing CI/CD configurations: ${error.message}`);
      throw new Error(`Failed to setup CI/CD pipelines: ${error.message}`);
    }
  }

  /**
   * Create Docker configuration for containerization
   * @param {Object} options - The containerization options
   * @returns {Object} The Docker configuration files
   */
  async createDockerConfiguration(options) {
    const prompt = this.createPrompt('create_docker_configuration', {
      options
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const dockerConfigs = JSON.parse(response);
      
      // Store the Docker configurations in the knowledge base
      await this.knowledgeBase.storeKnowledge('devops.docker_configurations', dockerConfigs);
      
      // Notify other agents about the Docker configurations
      await this.messageQueue.publish('devops.docker_configuration_created', { dockerConfigs });
      
      return dockerConfigs;
    } catch (error) {
      logger.error(`Error parsing Docker configurations: ${error.message}`);
      throw new Error(`Failed to create Docker configurations: ${error.message}`);
    }
  }

  /**
   * Setup monitoring and logging for the project
   * @param {Object} options - The monitoring and logging options
   * @returns {Object} The monitoring and logging configuration files
   */
  async setupMonitoring(options) {
    const infrastructureDesign = await this.knowledgeBase.retrieveKnowledge('devops.infrastructure_design');
    const prompt = this.createPrompt('setup_monitoring', {
      options,
      infrastructureDesign
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const monitoringConfigs = JSON.parse(response);
      
      // Store the monitoring configurations in the knowledge base
      await this.knowledgeBase.storeKnowledge('devops.monitoring_configurations', monitoringConfigs);
      
      // Notify other agents about the monitoring configurations
      await this.messageQueue.publish('devops.monitoring_setup_complete', { monitoringConfigs });
      
      return monitoringConfigs;
    } catch (error) {
      logger.error(`Error parsing monitoring configurations: ${error.message}`);
      throw new Error(`Failed to setup monitoring: ${error.message}`);
    }
  }

  /**
   * Generate deployment scripts
   * @param {Object} options - The deployment options
   * @returns {Object} The deployment scripts
   */
  async generateDeploymentScripts(options) {
    const infrastructureDesign = await this.knowledgeBase.retrieveKnowledge('devops.infrastructure_design');
    const dockerConfigs = await this.knowledgeBase.retrieveKnowledge('devops.docker_configurations');
    
    const prompt = this.createPrompt('generate_deployment_scripts', {
      options,
      infrastructureDesign,
      dockerConfigs
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const deploymentScripts = JSON.parse(response);
      
      // Store the deployment scripts in the knowledge base
      await this.knowledgeBase.storeKnowledge('devops.deployment_scripts', deploymentScripts);
      
      // Notify other agents about the deployment scripts
      await this.messageQueue.publish('devops.deployment_scripts_generated', { deploymentScripts });
      
      return deploymentScripts;
    } catch (error) {
      logger.error(`Error parsing deployment scripts: ${error.message}`);
      throw new Error(`Failed to generate deployment scripts: ${error.message}`);
    }
  }

  /**
   * Create database migration scripts for deployment
   * @param {Object} migrations - The database migrations
   * @returns {Object} The migration deployment scripts
   */
  async createMigrationScripts(migrations) {
    const infrastructureDesign = await this.knowledgeBase.retrieveKnowledge('devops.infrastructure_design');
    
    const prompt = this.createPrompt('create_migration_scripts', {
      migrations,
      infrastructureDesign
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const migrationScripts = JSON.parse(response);
      
      // Store the migration scripts in the knowledge base
      await this.knowledgeBase.storeKnowledge('devops.migration_scripts', migrationScripts);
      
      // Notify backend agent about the migration scripts
      await this.messageQueue.publish('devops.migration_scripts_created', { migrationScripts });
      
      return migrationScripts;
    } catch (error) {
      logger.error(`Error parsing migration scripts: ${error.message}`);
      throw new Error(`Failed to create migration scripts: ${error.message}`);
    }
  }

  /**
   * Configure auto-scaling for the infrastructure
   * @param {Object} options - The auto-scaling options
   * @returns {Object} The auto-scaling configuration
   */
  async configureAutoScaling(options) {
    const infrastructureDesign = await this.knowledgeBase.retrieveKnowledge('devops.infrastructure_design');
    
    const prompt = this.createPrompt('configure_auto_scaling', {
      options,
      infrastructureDesign
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const autoScalingConfig = JSON.parse(response);
      
      // Store the auto-scaling configuration in the knowledge base
      await this.knowledgeBase.storeKnowledge('devops.auto_scaling_configuration', autoScalingConfig);
      
      // Notify other agents about the auto-scaling configuration
      await this.messageQueue.publish('devops.auto_scaling_configured', { autoScalingConfig });
      
      return autoScalingConfig;
    } catch (error) {
      logger.error(`Error parsing auto-scaling configuration: ${error.message}`);
      throw new Error(`Failed to configure auto-scaling: ${error.message}`);
    }
  }

  /**
   * Handle architecture decision events
   * @param {Object} message - The message containing architecture decisions
   */
  async handleArchitectureDecision(message) {
    logger.info(`${this.agentName} received architecture decision: ${JSON.stringify(message)}`);
    
    // Extract DevOps-relevant architecture decisions
    const { cloud_provider, deployment_strategy, scaling_requirements } = message;
    
    // Design infrastructure based on decisions
    await this.designInfrastructure({
      cloudProvider: cloud_provider,
      deploymentStrategy: deployment_strategy,
      scalingRequirements: scaling_requirements,
      projectRequirements: message
    });
  }

  /**
   * Handle backend code generated events
   * @param {Object} message - The message containing generated backend code
   */
  async handleBackendCodeGenerated(message) {
    logger.info(`${this.agentName} received backend code generated notification`);
    
    // Update infrastructure requirements based on backend code
    const infrastructureDesign = await this.knowledgeBase.retrieveKnowledge('devops.infrastructure_design') || {};
    
    // Add backend-specific infrastructure requirements
    infrastructureDesign.backend = {
      ...infrastructureDesign.backend,
      hasBackend: true,
      codeGenerated: true,
      files: Object.keys(message.codeFiles).length
    };
    
    // Update infrastructure design
    await this.knowledgeBase.storeKnowledge('devops.infrastructure_design', infrastructureDesign);
    
    // Check if both frontend and backend code are ready for container setup
    if (infrastructureDesign.frontend && infrastructureDesign.frontend.codeGenerated) {
      await this.createDockerConfiguration({
        frontend: infrastructureDesign.frontend,
        backend: infrastructureDesign.backend
      });
    }
  }

  /**
   * Handle frontend code generated events
   * @param {Object} message - The message containing generated frontend code
   */
  async handleFrontendCodeGenerated(message) {
    logger.info(`${this.agentName} received frontend code generated notification`);
    
    // Update infrastructure requirements based on frontend code
    const infrastructureDesign = await this.knowledgeBase.retrieveKnowledge('devops.infrastructure_design') || {};
    
    // Add frontend-specific infrastructure requirements
    infrastructureDesign.frontend = {
      ...infrastructureDesign.frontend,
      hasFrontend: true,
      codeGenerated: true,
      files: Object.keys(message.codeFiles).length
    };
    
    // Update infrastructure design
    await this.knowledgeBase.storeKnowledge('devops.infrastructure_design', infrastructureDesign);
    
    // Check if both frontend and backend code are ready for container setup
    if (infrastructureDesign.backend && infrastructureDesign.backend.codeGenerated) {
      await this.createDockerConfiguration({
        frontend: infrastructureDesign.frontend,
        backend: infrastructureDesign.backend
      });
    }
  }

  /**
   * Handle deployment request events
   * @param {Object} message - The message containing deployment request
   */
  async handleDeploymentRequest(message) {
    logger.info(`${this.agentName} received deployment request: ${JSON.stringify(message)}`);
    
    // Get necessary configurations
    const infrastructureDesign = await this.knowledgeBase.retrieveKnowledge('devops.infrastructure_design');
    const dockerConfigs = await this.knowledgeBase.retrieveKnowledge('devops.docker_configurations');
    
    // Generate deployment scripts if not already done
    if (!await this.knowledgeBase.retrieveKnowledge('devops.deployment_scripts')) {
      await this.generateDeploymentScripts({
        environment: message.environment || 'production',
        rollback: true,
        infrastructureDesign,
        dockerConfigs
      });
    }
    
    // Setup CI/CD pipelines if not already done
    if (!await this.knowledgeBase.retrieveKnowledge('devops.cicd_configurations')) {
      await this.setupCiCdPipelines({
        cicdTool: message.cicdTool || this.supportedCiCdTools[0],
        environments: message.environments || ['development', 'staging', 'production']
      });
    }
    
    // Setup monitoring if not already done
    if (!await this.knowledgeBase.retrieveKnowledge('devops.monitoring_configurations')) {
      await this.setupMonitoring({
        metrics: ['cpu', 'memory', 'disk', 'network', 'errors', 'latency'],
        alerts: true
      });
    }
    
    // Notify deployment is ready
    await this.messageQueue.publish('devops.deployment_ready', {
      status: 'ready',
      environment: message.environment || 'production',
      deploymentScripts: await this.knowledgeBase.retrieveKnowledge('devops.deployment_scripts')
    });
  }

  /**
   * Handle migrations created events
   * @param {Object} message - The message containing created migrations
   */
  async handleMigrationsCreated(message) {
    logger.info(`${this.agentName} received migrations created notification`);
    
    // Create migration scripts for deployment
    await this.createMigrationScripts(message.migrations);
  }

  /**
   * Create a prompt for the model with appropriate context
   * @param {String} promptType - The type of prompt to create
   * @param {Object} contextData - The context data for the prompt
   * @returns {String} The complete prompt
   */
  createPrompt(promptType, contextData) {
    const basePrompt = `You are an expert DevOps engineer AI agent. Your task is to ${this.getPromptInstructionsByType(promptType)}.
    
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
      design_infrastructure: 'design cloud infrastructure based on project requirements',
      create_infrastructure_as_code: 'create Infrastructure as Code (IaC) configuration files',
      setup_cicd_pipelines: 'setup CI/CD pipelines for the project',
      create_docker_configuration: 'create Docker configuration for containerization',
      setup_monitoring: 'setup monitoring and logging for the project',
      generate_deployment_scripts: 'generate deployment scripts for the project',
      create_migration_scripts: 'create database migration scripts for deployment',
      configure_auto_scaling: 'configure auto-scaling for the infrastructure'
    };
    
    return instructionMap[promptType] || 'perform a DevOps task';
  }
}

module.exports = DevOpsAgent;
