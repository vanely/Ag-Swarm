const BaseAgent = require('../base-agent');
const { getModelClient } = require('../../models/model-orchestrator');
const VectorDb = require('../../core/memory/vector-db');
const KnowledgeBase = require('../../core/memory/knowledge-base');
const CodeEmbeddings = require('../../core/memory/code-embeddings');
const MessageQueue = require('../../core/communication/message-queue');
const logger = require('../../utils/logger');
const { SECURITY_STANDARDS, COMPLIANCE_FRAMEWORKS } = require('../../../config/default.json');

/**
 * SecurityAgent class responsible for security audits, vulnerability scanning,
 * compliance checking, and security best practices implementation
 */
class SecurityAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      agentName: 'security-agent',
      agentDescription: 'Responsible for security audits, vulnerability scanning, compliance, and security best practices',
      defaultModel: 'gpt-4-turbo',
      ...config
    });
    
    this.vectorDb = new VectorDb();
    this.knowledgeBase = new KnowledgeBase();
    this.codeEmbeddings = new CodeEmbeddings();
    this.messageQueue = new MessageQueue();
    
    this.supportedSecurityStandards = SECURITY_STANDARDS || [
      'owasp-top-10', 'sans-25', 'nist-800-53', 'iso-27001'
    ];
    
    this.supportedComplianceFrameworks = COMPLIANCE_FRAMEWORKS || [
      'gdpr', 'hipaa', 'pci-dss', 'sox', 'ccpa'
    ];
  }

  /**
   * Initialize the security agent
   */
  async initialize() {
    await super.initialize();
    logger.info(`${this.agentName} initialized with models: ${this.modelClient.modelName}`);
    
    // Subscribe to relevant topics
    this.messageQueue.subscribe('planning.security_requirements', this.handleSecurityRequirements.bind(this));
    this.messageQueue.subscribe('backend.code_generated', this.handleBackendCodeGenerated.bind(this));
    this.messageQueue.subscribe('frontend.code_generated', this.handleFrontendCodeGenerated.bind(this));
    this.messageQueue.subscribe('backend.auth_implemented', this.handleAuthImplemented.bind(this));
    this.messageQueue.subscribe('devops.infrastructure_designed', this.handleInfrastructureDesigned.bind(this));
    
    // Load security-specific knowledge
    await this.loadSecurityKnowledge();
  }

  /**
   * Load security-specific knowledge into memory systems
   */
  async loadSecurityKnowledge() {
    try {
      // Load security standards
      for (const standard of this.supportedSecurityStandards) {
        await this.knowledgeBase.loadKnowledge(`security.standards.${standard}`);
      }
      
      // Load compliance frameworks
      for (const framework of this.supportedComplianceFrameworks) {
        await this.knowledgeBase.loadKnowledge(`security.compliance.${framework}`);
      }
      
      // Load common vulnerabilities
      await this.knowledgeBase.loadKnowledge('security.common_vulnerabilities');
      
      // Load security best practices
      await this.knowledgeBase.loadKnowledge('security.best_practices.frontend');
      await this.knowledgeBase.loadKnowledge('security.best_practices.backend');
      await this.knowledgeBase.loadKnowledge('security.best_practices.devops');
      
      logger.info(`${this.agentName} loaded security knowledge successfully`);
    } catch (error) {
      logger.error(`Error loading security knowledge: ${error.message}`);
      throw error;
    }
  }

  /**
   * Analyze security requirements and create a security plan
   * @param {Object} securityRequirements - The security requirements
   * @returns {Object} The security plan
   */
  async createSecurityPlan(securityRequirements) {
    const prompt = this.createPrompt('create_security_plan', {
      securityRequirements,
      supportedSecurityStandards: this.supportedSecurityStandards,
      supportedComplianceFrameworks: this.supportedComplianceFrameworks
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const securityPlan = JSON.parse(response);
      
      // Store the security plan in the knowledge base
      await this.knowledgeBase.storeKnowledge('security.security_plan', securityPlan);
      
      // Notify other agents about the security plan
      await this.messageQueue.publish('security.security_plan_created', { securityPlan });
      
      return securityPlan;
    } catch (error) {
      logger.error(`Error parsing security plan: ${error.message}`);
      throw new Error(`Failed to create security plan: ${error.message}`);
    }
  }

  /**
   * Perform a security audit on code
   * @param {Object} codeFiles - The code files to audit
   * @param {String} codeType - The type of code (frontend/backend)
   * @returns {Object} The security audit results
   */
  async performSecurityAudit(codeFiles, codeType = 'backend') {
    const securityPlan = await this.knowledgeBase.retrieveKnowledge('security.security_plan');
    const securityStandards = await this.knowledgeBase.retrieveKnowledge(`security.standards.${securityPlan?.standards?.[0] || 'owasp-top-10'}`);
    const bestPractices = await this.knowledgeBase.retrieveKnowledge(`security.best_practices.${codeType}`);
    
    const prompt = this.createPrompt('perform_security_audit', {
      codeFiles,
      codeType,
      securityPlan,
      securityStandards,
      bestPractices
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const auditResults = JSON.parse(response);
      
      // Store the audit results in the knowledge base
      await this.knowledgeBase.storeKnowledge(`security.audit_results.${codeType}`, auditResults);
      
      // Notify relevant agents about the audit results
      await this.messageQueue.publish('security.audit_completed', { 
        codeType,
        auditResults
      });
      
      return auditResults;
    } catch (error) {
      logger.error(`Error parsing security audit results: ${error.message}`);
      throw new Error(`Failed to perform security audit: ${error.message}`);
    }
  }

  /**
   * Audit authentication and authorization implementation
   * @param {Object} authImplementation - The auth implementation
   * @returns {Object} The auth audit results
   */
  async auditAuthImplementation(authImplementation) {
    const securityPlan = await this.knowledgeBase.retrieveKnowledge('security.security_plan');
    const bestPractices = await this.knowledgeBase.retrieveKnowledge('security.best_practices.backend');
    
    const prompt = this.createPrompt('audit_auth_implementation', {
      authImplementation,
      securityPlan,
      bestPractices
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const authAuditResults = JSON.parse(response);
      
      // Store the auth audit results in the knowledge base
      await this.knowledgeBase.storeKnowledge('security.auth_audit_results', authAuditResults);
      
      // Notify backend agent about the auth audit results
      await this.messageQueue.publish('security.auth_audit_completed', { 
        authAuditResults
      });
      
      return authAuditResults;
    } catch (error) {
      logger.error(`Error parsing auth audit results: ${error.message}`);
      throw new Error(`Failed to audit auth implementation: ${error.message}`);
    }
  }

  /**
   * Audit infrastructure for security vulnerabilities
   * @param {Object} infrastructureDesign - The infrastructure design
   * @returns {Object} The infrastructure audit results
   */
  async auditInfrastructure(infrastructureDesign) {
    const securityPlan = await this.knowledgeBase.retrieveKnowledge('security.security_plan');
    const bestPractices = await this.knowledgeBase.retrieveKnowledge('security.best_practices.devops');
    
    const prompt = this.createPrompt('audit_infrastructure', {
      infrastructureDesign,
      securityPlan,
      bestPractices
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const infrastructureAuditResults = JSON.parse(response);
      
      // Store the infrastructure audit results in the knowledge base
      await this.knowledgeBase.storeKnowledge('security.infrastructure_audit_results', infrastructureAuditResults);
      
      // Notify DevOps agent about the infrastructure audit results
      await this.messageQueue.publish('security.infrastructure_audit_completed', { 
        infrastructureAuditResults
      });
      
      return infrastructureAuditResults;
    } catch (error) {
      logger.error(`Error parsing infrastructure audit results: ${error.message}`);
      throw new Error(`Failed to audit infrastructure: ${error.message}`);
    }
  }

  /**
   * Generate security recommendations based on audit results
   * @param {String} auditType - The type of audit (code/auth/infrastructure)
   * @returns {Object} The security recommendations
   */
  async generateSecurityRecommendations(auditType = 'code') {
    const auditResults = await this.knowledgeBase.retrieveKnowledge(`security.${auditType}_audit_results`);
    
    if (!auditResults) {
      throw new Error(`No audit results found for type: ${auditType}`);
    }
    
    const prompt = this.createPrompt('generate_security_recommendations', {
      auditResults,
      auditType
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const recommendations = JSON.parse(response);
      
      // Store the recommendations in the knowledge base
      await this.knowledgeBase.storeKnowledge(`security.recommendations.${auditType}`, recommendations);
      
      // Notify relevant agents about the recommendations
      await this.messageQueue.publish('security.recommendations_generated', { 
        auditType,
        recommendations
      });
      
      return recommendations;
    } catch (error) {
      logger.error(`Error parsing security recommendations: ${error.message}`);
      throw new Error(`Failed to generate security recommendations: ${error.message}`);
    }
  }

  /**
   * Check compliance with specific frameworks
   * @param {String} framework - The compliance framework
   * @returns {Object} The compliance check results
   */
  async checkCompliance(framework = 'gdpr') {
    if (!this.supportedComplianceFrameworks.includes(framework)) {
      throw new Error(`Unsupported compliance framework: ${framework}`);
    }
    
    const securityPlan = await this.knowledgeBase.retrieveKnowledge('security.security_plan');
    const complianceKnowledge = await this.knowledgeBase.retrieveKnowledge(`security.compliance.${framework}`);
    
    // Get all audit results
    const codeAuditResults = await this.knowledgeBase.retrieveKnowledge('security.audit_results.backend');
    const authAuditResults = await this.knowledgeBase.retrieveKnowledge('security.auth_audit_results');
    const infrastructureAuditResults = await this.knowledgeBase.retrieveKnowledge('security.infrastructure_audit_results');
    
    const prompt = this.createPrompt('check_compliance', {
      framework,
      securityPlan,
      complianceKnowledge,
      codeAuditResults,
      authAuditResults,
      infrastructureAuditResults
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const complianceResults = JSON.parse(response);
      
      // Store the compliance results in the knowledge base
      await this.knowledgeBase.storeKnowledge(`security.compliance_results.${framework}`, complianceResults);
      
      // Notify other agents about the compliance results
      await this.messageQueue.publish('security.compliance_check_completed', { 
        framework,
        complianceResults
      });
      
      return complianceResults;
    } catch (error) {
      logger.error(`Error parsing compliance results: ${error.message}`);
      throw new Error(`Failed to check compliance with ${framework}: ${error.message}`);
    }
  }

  /**
   * Generate security-focused code fixes
   * @param {Object} vulnerabilities - The identified vulnerabilities
   * @param {String} codeType - The type of code (frontend/backend)
   * @returns {Object} The code fixes
   */
  async generateSecurityFixes(vulnerabilities, codeType = 'backend') {
    const bestPractices = await this.knowledgeBase.retrieveKnowledge(`security.best_practices.${codeType}`);
    
    const prompt = this.createPrompt('generate_security_fixes', {
      vulnerabilities,
      codeType,
      bestPractices
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const securityFixes = JSON.parse(response);
      
      // Store the security fixes in the knowledge base
      await this.knowledgeBase.storeKnowledge(`security.fixes.${codeType}`, securityFixes);
      
      // Notify relevant agents about the security fixes
      await this.messageQueue.publish('security.fixes_generated', { 
        codeType,
        securityFixes
      });
      
      return securityFixes;
    } catch (error) {
      logger.error(`Error parsing security fixes: ${error.message}`);
      throw new Error(`Failed to generate security fixes: ${error.message}`);
    }
  }

  /**
   * Create a security documentation for the project
   * @returns {Object} The security documentation
   */
  async createSecurityDocumentation() {
    const securityPlan = await this.knowledgeBase.retrieveKnowledge('security.security_plan');
    const backendAuditResults = await this.knowledgeBase.retrieveKnowledge('security.audit_results.backend');
    const frontendAuditResults = await this.knowledgeBase.retrieveKnowledge('security.audit_results.frontend');
    const authAuditResults = await this.knowledgeBase.retrieveKnowledge('security.auth_audit_results');
    const infrastructureAuditResults = await this.knowledgeBase.retrieveKnowledge('security.infrastructure_audit_results');
    
    const prompt = this.createPrompt('create_security_documentation', {
      securityPlan,
      backendAuditResults,
      frontendAuditResults,
      authAuditResults,
      infrastructureAuditResults
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const securityDocumentation = JSON.parse(response);
      
      // Store the security documentation in the knowledge base
      await this.knowledgeBase.storeKnowledge('security.documentation', securityDocumentation);
      
      // Notify other agents about the security documentation
      await this.messageQueue.publish('security.documentation_created', { 
        securityDocumentation
      });
      
      return securityDocumentation;
    } catch (error) {
      logger.error(`Error parsing security documentation: ${error.message}`);
      throw new Error(`Failed to create security documentation: ${error.message}`);
    }
  }

  /**
   * Handle security requirements events
   * @param {Object} message - The message containing security requirements
   */
  async handleSecurityRequirements(message) {
    logger.info(`${this.agentName} received security requirements: ${JSON.stringify(message)}`);
    
    // Create a security plan based on the requirements
    await this.createSecurityPlan(message);
  }

  /**
   * Handle backend code generated events
   * @param {Object} message - The message containing generated backend code
   */
  async handleBackendCodeGenerated(message) {
    logger.info(`${this.agentName} received backend code generated notification`);
    
    // Perform security audit on backend code
    await this.performSecurityAudit(message.codeFiles, 'backend');
    
    // Generate security recommendations based on the audit
    await this.generateSecurityRecommendations('audit_results.backend');
  }

  /**
   * Handle frontend code generated events
   * @param {Object} message - The message containing generated frontend code
   */
  async handleFrontendCodeGenerated(message) {
    logger.info(`${this.agentName} received frontend code generated notification`);
    
    // Perform security audit on frontend code
    await this.performSecurityAudit(message.codeFiles, 'frontend');
    
    // Generate security recommendations based on the audit
    await this.generateSecurityRecommendations('audit_results.frontend');
  }

  /**
   * Handle auth implemented events
   * @param {Object} message - The message containing auth implementation
   */
  async handleAuthImplemented(message) {
    logger.info(`${this.agentName} received auth implementation notification`);
    
    // Audit authentication and authorization implementation
    await this.auditAuthImplementation(message.authImplementation);
    
    // Generate security recommendations based on the audit
    await this.generateSecurityRecommendations('auth_audit_results');
  }

  /**
   * Handle infrastructure designed events
   * @param {Object} message - The message containing infrastructure design
   */
  async handleInfrastructureDesigned(message) {
    logger.info(`${this.agentName} received infrastructure design notification`);
    
    // Audit infrastructure for security vulnerabilities
    await this.auditInfrastructure(message.infrastructure);
    
    // Generate security recommendations based on the audit
    await this.generateSecurityRecommendations('infrastructure_audit_results');
  }

  /**
   * Create a prompt for the model with appropriate context
   * @param {String} promptType - The type of prompt to create
   * @param {Object} contextData - The context data for the prompt
   * @returns {String} The complete prompt
   */
  createPrompt(promptType, contextData) {
    const basePrompt = `You are an expert security engineer AI agent. Your task is to ${this.getPromptInstructionsByType(promptType)}.
    
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
      create_security_plan: 'analyze security requirements and create a comprehensive security plan',
      perform_security_audit: 'perform a thorough security audit on code to identify vulnerabilities and security issues',
      audit_auth_implementation: 'audit authentication and authorization implementation for security vulnerabilities',
      audit_infrastructure: 'audit infrastructure design for security vulnerabilities and misconfigurations',
      generate_security_recommendations: 'generate security recommendations based on audit results',
      check_compliance: 'check compliance with specific regulatory frameworks',
      generate_security_fixes: 'generate security-focused code fixes for identified vulnerabilities',
      create_security_documentation: 'create comprehensive security documentation for the project'
    };
    
    return instructionMap[promptType] || 'perform a security task';
  }
}

module.exports = SecurityAgent;
