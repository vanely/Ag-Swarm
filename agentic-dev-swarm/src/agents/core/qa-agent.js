const BaseAgent = require('../base-agent');
const { getModelClient } = require('../../models/model-orchestrator');
const VectorDb = require('../../core/memory/vector-db');
const KnowledgeBase = require('../../core/memory/knowledge-base');
const CodeEmbeddings = require('../../core/memory/code-embeddings');
const MessageQueue = require('../../core/communication/message-queue');
const logger = require('../../utils/logger');
const { QA_TEST_FRAMEWORKS } = require('../../../config/default.json');

/**
 * QAAgent class responsible for test design, test automation,
 * quality assurance, and bug tracking
 */
class QAAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      agentName: 'qa-agent',
      agentDescription: 'Responsible for test design, test automation, quality assurance, and bug tracking',
      defaultModel: 'gpt-4-turbo',
      ...config
    });
    
    this.vectorDb = new VectorDb();
    this.knowledgeBase = new KnowledgeBase();
    this.codeEmbeddings = new CodeEmbeddings();
    this.messageQueue = new MessageQueue();
    
    this.supportedTestFrameworks = QA_TEST_FRAMEWORKS || {
      backend: ['jest', 'mocha', 'pytest', 'junit'],
      frontend: ['jest', 'cypress', 'selenium', 'playwright'],
      e2e: ['cypress', 'playwright', 'selenium', 'puppeteer']
    };
  }

  /**
   * Initialize the QA agent
   */
  async initialize() {
    await super.initialize();
    logger.info(`${this.agentName} initialized with models: ${this.modelClient.modelName}`);
    
    // Subscribe to relevant topics
    this.messageQueue.subscribe('planning.architecture_decided', this.handleArchitectureDecision.bind(this));
    this.messageQueue.subscribe('backend.code_generated', this.handleBackendCodeGenerated.bind(this));
    this.messageQueue.subscribe('frontend.code_generated', this.handleFrontendCodeGenerated.bind(this));
    this.messageQueue.subscribe('security.audit_completed', this.handleSecurityAuditCompleted.bind(this));
    
    // Load QA-specific knowledge
    await this.loadQAKnowledge();
  }

  /**
   * Load QA-specific knowledge into memory systems
   */
  async loadQAKnowledge() {
    try {
      // Load test framework knowledge
      for (const type in this.supportedTestFrameworks) {
        for (const framework of this.supportedTestFrameworks[type]) {
          await this.knowledgeBase.loadKnowledge(`qa.test_frameworks.${type}.${framework}`);
        }
      }
      
      // Load testing best practices
      await this.knowledgeBase.loadKnowledge('qa.best_practices.unit_testing');
      await this.knowledgeBase.loadKnowledge('qa.best_practices.integration_testing');
      await this.knowledgeBase.loadKnowledge('qa.best_practices.e2e_testing');
      await this.knowledgeBase.loadKnowledge('qa.best_practices.performance_testing');
      
      // Load test patterns
      await this.knowledgeBase.loadKnowledge('qa.test_patterns');
      
      logger.info(`${this.agentName} loaded QA knowledge successfully`);
    } catch (error) {
      logger.error(`Error loading QA knowledge: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a test plan based on project requirements and architecture
   * @param {Object} projectRequirements - The project requirements
   * @param {Object} architecture - The project architecture
   * @returns {Object} The test plan
   */
  async createTestPlan(projectRequirements, architecture) {
    const prompt = this.createPrompt('create_test_plan', {
      projectRequirements,
      architecture,
      supportedTestFrameworks: this.supportedTestFrameworks
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const testPlan = JSON.parse(response);
      
      // Store the test plan in the knowledge base
      await this.knowledgeBase.storeKnowledge('qa.test_plan', testPlan);
      
      // Notify other agents about the test plan
      await this.messageQueue.publish('qa.test_plan_created', { testPlan });
      
      return testPlan;
    } catch (error) {
      logger.error(`Error parsing test plan: ${error.message}`);
      throw new Error(`Failed to create test plan: ${error.message}`);
    }
  }

  /**
   * Generate unit tests for backend code
   * @param {Object} codeFiles - The backend code files
   * @returns {Object} The unit tests
   */
  async generateBackendUnitTests(codeFiles) {
    const testPlan = await this.knowledgeBase.retrieveKnowledge('qa.test_plan');
    const architecture = await this.knowledgeBase.retrieveKnowledge('planning.architecture') || {};
    
    // Determine the test framework to use
    const testFramework = testPlan?.backend?.unitTestFramework || this.supportedTestFrameworks.backend[0];
    const testFrameworkKnowledge = await this.knowledgeBase.retrieveKnowledge(`qa.test_frameworks.backend.${testFramework}`);
    const bestPractices = await this.knowledgeBase.retrieveKnowledge('qa.best_practices.unit_testing');
    
    const prompt = this.createPrompt('generate_backend_unit_tests', {
      codeFiles,
      architecture,
      testFramework,
      testFrameworkKnowledge,
      bestPractices
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const unitTests = JSON.parse(response);
      
      // Store the unit tests in the knowledge base
      await this.knowledgeBase.storeKnowledge('qa.backend_unit_tests', unitTests);
      
      // Notify other agents about the unit tests
      await this.messageQueue.publish('qa.backend_unit_tests_generated', { unitTests });
      
      return unitTests;
    } catch (error) {
      logger.error(`Error parsing backend unit tests: ${error.message}`);
      throw new Error(`Failed to generate backend unit tests: ${error.message}`);
    }
  }

  /**
   * Generate unit tests for frontend code
   * @param {Object} codeFiles - The frontend code files
   * @returns {Object} The unit tests
   */
  async generateFrontendUnitTests(codeFiles) {
    const testPlan = await this.knowledgeBase.retrieveKnowledge('qa.test_plan');
    const architecture = await this.knowledgeBase.retrieveKnowledge('planning.architecture') || {};
    
    // Determine the test framework to use
    const testFramework = testPlan?.frontend?.unitTestFramework || this.supportedTestFrameworks.frontend[0];
    const testFrameworkKnowledge = await this.knowledgeBase.retrieveKnowledge(`qa.test_frameworks.frontend.${testFramework}`);
    const bestPractices = await this.knowledgeBase.retrieveKnowledge('qa.best_practices.unit_testing');
    
    const prompt = this.createPrompt('generate_frontend_unit_tests', {
      codeFiles,
      architecture,
      testFramework,
      testFrameworkKnowledge,
      bestPractices
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const unitTests = JSON.parse(response);
      
      // Store the unit tests in the knowledge base
      await this.knowledgeBase.storeKnowledge('qa.frontend_unit_tests', unitTests);
      
      // Notify other agents about the unit tests
      await this.messageQueue.publish('qa.frontend_unit_tests_generated', { unitTests });
      
      return unitTests;
    } catch (error) {
      logger.error(`Error parsing frontend unit tests: ${error.message}`);
      throw new Error(`Failed to generate frontend unit tests: ${error.message}`);
    }
  }

  /**
   * Generate integration tests for the project
   * @returns {Object} The integration tests
   */
  async generateIntegrationTests() {
    const testPlan = await this.knowledgeBase.retrieveKnowledge('qa.test_plan');
    const architecture = await this.knowledgeBase.retrieveKnowledge('planning.architecture') || {};
    const backendCode = await this.knowledgeBase.retrieveKnowledge('backend.generated_code');
    const frontendCode = await this.knowledgeBase.retrieveKnowledge('frontend.generated_code');
    
    const bestPractices = await this.knowledgeBase.retrieveKnowledge('qa.best_practices.integration_testing');
    
    const prompt = this.createPrompt('generate_integration_tests', {
      architecture,
      testPlan,
      backendCode,
      frontendCode,
      bestPractices
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const integrationTests = JSON.parse(response);
      
      // Store the integration tests in the knowledge base
      await this.knowledgeBase.storeKnowledge('qa.integration_tests', integrationTests);
      
      // Notify other agents about the integration tests
      await this.messageQueue.publish('qa.integration_tests_generated', { integrationTests });
      
      return integrationTests;
    } catch (error) {
      logger.error(`Error parsing integration tests: ${error.message}`);
      throw new Error(`Failed to generate integration tests: ${error.message}`);
    }
  }

  /**
   * Generate end-to-end tests for the project
   * @returns {Object} The E2E tests
   */
  async generateE2ETests() {
    const testPlan = await this.knowledgeBase.retrieveKnowledge('qa.test_plan');
    const architecture = await this.knowledgeBase.retrieveKnowledge('planning.architecture') || {};
    
    // Determine the test framework to use
    const testFramework = testPlan?.e2e?.framework || this.supportedTestFrameworks.e2e[0];
    const testFrameworkKnowledge = await this.knowledgeBase.retrieveKnowledge(`qa.test_frameworks.e2e.${testFramework}`);
    const bestPractices = await this.knowledgeBase.retrieveKnowledge('qa.best_practices.e2e_testing');
    
    const prompt = this.createPrompt('generate_e2e_tests', {
      architecture,
      testPlan,
      testFramework,
      testFrameworkKnowledge,
      bestPractices
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const e2eTests = JSON.parse(response);
      
      // Store the E2E tests in the knowledge base
      await this.knowledgeBase.storeKnowledge('qa.e2e_tests', e2eTests);
      
      // Notify other agents about the E2E tests
      await this.messageQueue.publish('qa.e2e_tests_generated', { e2eTests });
      
      return e2eTests;
    } catch (error) {
      logger.error(`Error parsing E2E tests: ${error.message}`);
      throw new Error(`Failed to generate E2E tests: ${error.message}`);
    }
  }

  /**
   * Generate performance tests for the project
   * @returns {Object} The performance tests
   */
  async generatePerformanceTests() {
    const testPlan = await this.knowledgeBase.retrieveKnowledge('qa.test_plan');
    const architecture = await this.knowledgeBase.retrieveKnowledge('planning.architecture') || {};
    const bestPractices = await this.knowledgeBase.retrieveKnowledge('qa.best_practices.performance_testing');
    
    const prompt = this.createPrompt('generate_performance_tests', {
      architecture,
      testPlan,
      bestPractices
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const performanceTests = JSON.parse(response);
      
      // Store the performance tests in the knowledge base
      await this.knowledgeBase.storeKnowledge('qa.performance_tests', performanceTests);
      
      // Notify other agents about the performance tests
      await this.messageQueue.publish('qa.performance_tests_generated', { performanceTests });
      
      return performanceTests;
    } catch (error) {
      logger.error(`Error parsing performance tests: ${error.message}`);
      throw new Error(`Failed to generate performance tests: ${error.message}`);
    }
  }

  /**
   * Analyze code for potential bugs and issues
   * @param {Object} codeFiles - The code files to analyze
   * @param {String} codeType - The type of code (frontend/backend)
   * @returns {Object} The bug analysis results
   */
  async analyzeBugs(codeFiles, codeType = 'backend') {
    const bestPractices = await this.knowledgeBase.retrieveKnowledge(`qa.best_practices.${codeType === 'backend' ? 'unit_testing' : 'unit_testing'}`);
    
    const prompt = this.createPrompt('analyze_bugs', {
      codeFiles,
      codeType,
      bestPractices
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const bugAnalysis = JSON.parse(response);
      
      // Store the bug analysis in the knowledge base
      await this.knowledgeBase.storeKnowledge(`qa.bug_analysis.${codeType}`, bugAnalysis);
      
      // Notify other agents about the bug analysis
      await this.messageQueue.publish('qa.bug_analysis_completed', { 
        codeType,
        bugAnalysis
      });
      
      return bugAnalysis;
    } catch (error) {
      logger.error(`Error parsing bug analysis: ${error.message}`);
      throw new Error(`Failed to analyze bugs: ${error.message}`);
    }
  }

  /**
   * Generate test coverage report
   * @param {Object} unitTests - The unit tests
   * @param {Object} integrationTests - The integration tests
   * @param {Object} e2eTests - The E2E tests
   * @returns {Object} The test coverage report
   */
  async generateTestCoverageReport(unitTests, integrationTests, e2eTests) {
    const prompt = this.createPrompt('generate_test_coverage_report', {
      unitTests,
      integrationTests,
      e2eTests
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const coverageReport = JSON.parse(response);
      
      // Store the coverage report in the knowledge base
      await this.knowledgeBase.storeKnowledge('qa.test_coverage_report', coverageReport);
      
      // Notify other agents about the coverage report
      await this.messageQueue.publish('qa.test_coverage_report_generated', { coverageReport });
      
      return coverageReport;
    } catch (error) {
      logger.error(`Error parsing test coverage report: ${error.message}`);
      throw new Error(`Failed to generate test coverage report: ${error.message}`);
    }
  }

  /**
   * Create a QA report summarizing all testing activities
   * @returns {Object} The QA report
   */
  async createQAReport() {
    const testPlan = await this.knowledgeBase.retrieveKnowledge('qa.test_plan');
    const backendUnitTests = await this.knowledgeBase.retrieveKnowledge('qa.backend_unit_tests');
    const frontendUnitTests = await this.knowledgeBase.retrieveKnowledge('qa.frontend_unit_tests');
    const integrationTests = await this.knowledgeBase.retrieveKnowledge('qa.integration_tests');
    const e2eTests = await this.knowledgeBase.retrieveKnowledge('qa.e2e_tests');
    const performanceTests = await this.knowledgeBase.retrieveKnowledge('qa.performance_tests');
    const backendBugAnalysis = await this.knowledgeBase.retrieveKnowledge('qa.bug_analysis.backend');
    const frontendBugAnalysis = await this.knowledgeBase.retrieveKnowledge('qa.bug_analysis.frontend');
    const testCoverageReport = await this.knowledgeBase.retrieveKnowledge('qa.test_coverage_report');
    
    const prompt = this.createPrompt('create_qa_report', {
      testPlan,
      backendUnitTests,
      frontendUnitTests,
      integrationTests,
      e2eTests,
      performanceTests,
      backendBugAnalysis,
      frontendBugAnalysis,
      testCoverageReport
    });
    
    const response = await this.modelClient.complete(prompt);
    
    try {
      const qaReport = JSON.parse(response);
      
      // Store the QA report in the knowledge base
      await this.knowledgeBase.storeKnowledge('qa.qa_report', qaReport);
      
      // Notify other agents about the QA report
      await this.messageQueue.publish('qa.qa_report_created', { qaReport });
      
      return qaReport;
    } catch (error) {
      logger.error(`Error parsing QA report: ${error.message}`);
      throw new Error(`Failed to create QA report: ${error.message}`);
    }
  }

  /**
   * Handle architecture decision events
   * @param {Object} message - The message containing architecture decisions
   */
  async handleArchitectureDecision(message) {
    logger.info(`${this.agentName} received architecture decision: ${JSON.stringify(message)}`);
    
    // Create a test plan based on the architecture and project requirements
    await this.createTestPlan(message, message.architecture);
  }

  /**
   * Handle backend code generated events
   * @param {Object} message - The message containing generated backend code
   */
  async handleBackendCodeGenerated(message) {
    logger.info(`${this.agentName} received backend code generated notification`);
    
    // Store backend code in knowledge base for reference
    await this.knowledgeBase.storeKnowledge('backend.generated_code', message.codeFiles);
    
    // Generate unit tests for backend code
    await this.generateBackendUnitTests(message.codeFiles);
    
    // Analyze backend code for bugs
    await this.analyzeBugs(message.codeFiles, 'backend');
    
    // Check if frontend code is also available for integration tests
    if (await this.knowledgeBase.retrieveKnowledge('frontend.generated_code')) {
      await this.generateIntegrationTests();
    }
  }

  /**
   * Handle frontend code generated events
   * @param {Object} message - The message containing generated frontend code
   */
  async handleFrontendCodeGenerated(message) {
    logger.info(`${this.agentName} received frontend code generated notification`);
    
    // Store frontend code in knowledge base for reference
    await this.knowledgeBase.storeKnowledge('frontend.generated_code', message.codeFiles);
    
    // Generate unit tests for frontend code
    await this.generateFrontendUnitTests(message.codeFiles);
    
    // Analyze frontend code for bugs
    await this.analyzeBugs(message.codeFiles, 'frontend');
    
    // Check if backend code is also available for integration tests
    if (await this.knowledgeBase.retrieveKnowledge('backend.generated_code')) {
      await this.generateIntegrationTests();
    }
    
    // Generate E2E tests once frontend code is available
    await this.generateE2ETests();
  }

  /**
   * Handle security audit completed events
   * @param {Object} message - The message containing security audit results
   */
  async handleSecurityAuditCompleted(message) {
    logger.info(`${this.agentName} received security audit completed notification`);
    
    // Store security audit results for reference in QA report
    await this.knowledgeBase.storeKnowledge(`qa.security_audit.${message.codeType}`, message.auditResults);
    
    // Check if all necessary tests have been generated to create a coverage report
    const backendUnitTests = await this.knowledgeBase.retrieveKnowledge('qa.backend_unit_tests');
    const frontendUnitTests = await this.knowledgeBase.retrieveKnowledge('qa.frontend_unit_tests');
    const integrationTests = await this.knowledgeBase.retrieveKnowledge('qa.integration_tests');
    const e2eTests = await this.knowledgeBase.retrieveKnowledge('qa.e2e_tests');
    
    if (backendUnitTests && frontendUnitTests && integrationTests && e2eTests) {
      // Generate test coverage report
      await this.generateTestCoverageReport(
        { backend: backendUnitTests, frontend: frontendUnitTests }, 
        integrationTests, 
        e2eTests
      );
      
      // Generate performance tests
      await this.generatePerformanceTests();
      
      // Create QA report
      await this.createQAReport();
    }
  }

  /**
   * Create a prompt for the model with appropriate context
   * @param {String} promptType - The type of prompt to create
   * @param {Object} contextData - The context data for the prompt
   * @returns {String} The complete prompt
   */
  createPrompt(promptType, contextData) {
    const basePrompt = `You are an expert Quality Assurance engineer AI agent. Your task is to ${this.getPromptInstructionsByType(promptType)}.
    
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
      create_test_plan: 'create a comprehensive test plan based on project requirements and architecture',
      generate_backend_unit_tests: 'generate unit tests for backend code following best practices',
      generate_frontend_unit_tests: 'generate unit tests for frontend code following best practices',
      generate_integration_tests: 'generate integration tests to verify the interactions between components',
      generate_e2e_tests: 'generate end-to-end tests to verify the entire application flow',
      generate_performance_tests: 'generate performance tests to measure application performance',
      analyze_bugs: 'analyze code for potential bugs and issues',
      generate_test_coverage_report: 'generate a test coverage report based on the tests',
      create_qa_report: 'create a comprehensive QA report summarizing all testing activities'
    };
    
    return instructionMap[promptType] || 'perform a QA task';
  }
}

module.exports = QAAgent;
