/**
 * Planning Agent for the Agentic Software Development Swarm
 * 
 * This agent is responsible for generating PRDs, technical specifications,
 * and architecture decisions.
 */

const fs = require('fs').promises;
const path = require('path');
const BaseAgent = require('../base-agent');
const logger = require('../../utils/logger');

class PlanningAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      type: 'planning',
      name: 'Strategic Planning Agent',
      specializations: [
        'requirements-analysis',
        'system-architecture',
        'technical-specification',
        'task-decomposition',
        'project-planning'
      ],
      capabilities: [
        'prd-generation',
        'architecture-design',
        'data-modeling',
        'api-design',
        'task-breakdown'
      ],
      model: config.model || 'claude-opus-4.1', // Default to Claude for planning tasks
      ...config
    });
    
    this.templatePath = config.templatePath || path.join(__dirname, '../../templates/prd');
    this.templates = new Map();
    
    logger.info('Planning Agent initialized');
  }
  
  /**
   * Initialize the agent
   */
  async initialize() {
    await super.initialize();
    
    try {
      // Load templates
      await this.loadTemplates();
      
      logger.info(`Planning Agent ${this.config.id} ready with ${this.templates.size} templates`);
      
      return true;
    } catch (error) {
      logger.error(`Error initializing Planning Agent: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Load planning templates
   */
  async loadTemplates() {
    try {
      // Check if template directory exists
      try {
        await fs.access(this.templatePath);
      } catch (error) {
        logger.warn(`Template directory ${this.templatePath} not found, using default templates`);
        
        // Use default templates if directory doesn't exist
        this.templates.set('prd', DEFAULT_PRD_TEMPLATE);
        this.templates.set('architecture', DEFAULT_ARCHITECTURE_TEMPLATE);
        this.templates.set('api-spec', DEFAULT_API_SPEC_TEMPLATE);
        this.templates.set('data-model', DEFAULT_DATA_MODEL_TEMPLATE);
        this.templates.set('task-breakdown', DEFAULT_TASK_BREAKDOWN_TEMPLATE);
        
        return;
      }
      
      // Read all template files
      const files = await fs.readdir(this.templatePath);
      
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        
        const templateName = path.basename(file, '.md');
        const filePath = path.join(this.templatePath, file);
        
        try {
          const content = await fs.readFile(filePath, 'utf8');
          this.templates.set(templateName, content);
          
          logger.debug(`Loaded template: ${templateName}`);
        } catch (error) {
          logger.error(`Error loading template ${filePath}: ${error.message}`);
        }
      }
      
      // If no templates were found, use default templates
      if (this.templates.size === 0) {
        logger.warn('No templates found, using default templates');
        
        this.templates.set('prd', DEFAULT_PRD_TEMPLATE);
        this.templates.set('architecture', DEFAULT_ARCHITECTURE_TEMPLATE);
        this.templates.set('api-spec', DEFAULT_API_SPEC_TEMPLATE);
        this.templates.set('data-model', DEFAULT_DATA_MODEL_TEMPLATE);
        this.templates.set('task-breakdown', DEFAULT_TASK_BREAKDOWN_TEMPLATE);
      }
    } catch (error) {
      logger.error(`Error loading templates: ${error.message}`);
      
      // Use default templates as fallback
      this.templates.set('prd', DEFAULT_PRD_TEMPLATE);
      this.templates.set('architecture', DEFAULT_ARCHITECTURE_TEMPLATE);
      this.templates.set('api-spec', DEFAULT_API_SPEC_TEMPLATE);
      this.templates.set('data-model', DEFAULT_DATA_MODEL_TEMPLATE);
      this.templates.set('task-breakdown', DEFAULT_TASK_BREAKDOWN_TEMPLATE);
    }
  }
  
  /**
   * Process a task
   * 
   * @param {Object} task - Task to process
   * @returns {Object} Task result
   */
  async processTask(task) {
    logger.info(`Planning Agent processing task: ${task.type || 'unknown'}`);
    
    switch (task.type) {
      case 'generate-prd':
        return await this.generatePRD(task);
        
      case 'create-architecture':
        return await this.createArchitecture(task);
        
      case 'design-api':
        return await this.designAPI(task);
        
      case 'create-data-model':
        return await this.createDataModel(task);
        
      case 'decompose-tasks':
        return await this.decomposeTasks(task);
        
      case 'analyze-requirements':
        return await this.analyzeRequirements(task);
        
      case 'plan-project':
        return await this.planProject(task);
        
      default:
        throw new Error(`Unsupported task type: ${task.type || 'undefined'}`);
    }
  }
  
  // [Previous methods omitted for brevity]
  
  /**
   * Analyze project requirements
   * 
   * @param {Object} task - Requirements analysis task
   * @returns {Object} Requirements analysis
   */
  async analyzeRequirements(task) {
    logger.info('Analyzing project requirements');
    
    if (!task.requirements) {
      throw new Error('Task must include requirements field');
    }
    
    const requirements = task.requirements;
    const projectName = task.projectName || 'New Project';
    
    // Prepare the prompt for the model
    const prompt = `
# Task: Analyze Project Requirements

## Project Information
- Project Name: ${projectName}

## Requirements
${typeof requirements === 'object' ? JSON.stringify(requirements, null, 2) : requirements}

## Instructions
Please analyze the provided project requirements and provide a detailed assessment. 
Your analysis should include:

1. **Completeness Assessment** - Are the requirements complete? Identify any missing information.
2. **Clarity Assessment** - Are the requirements clear and unambiguous?
3. **Consistency Check** - Are there any contradictory or conflicting requirements?
4. **Technical Feasibility** - Are all requirements technically feasible?
5. **Risk Assessment** - Identify potential risks and challenges.
6. **Recommendations** - Provide recommendations for improving the requirements.
7. **Questions** - List questions that need clarification.
8. **Summary** - Overall assessment and key findings.

Be thorough but concise in your analysis. Focus on actionable insights rather than general statements.
`;
    
    try {
      // Generate requirements analysis
      const analysisContent = await this.generateText(prompt, {
        temperature: 0.1,
        max_tokens: 4000,
        system_prompt: "You are a Senior Business Analyst with extensive experience analyzing and refining software requirements. You excel at identifying gaps, inconsistencies, and risks in project requirements. Your feedback is always constructive, precise, and actionable."
      });
      
      // Parse and structure the analysis
      const analysis = this.parseRequirementsAnalysis(analysisContent, projectName);
      
      // Store in knowledge base if enabled
      if (this.config.useKnowledgeBase && this.knowledgeBase) {
        await this.storeKnowledge('requirements-analysis', `req-analysis-${task.id}`, {
          title: `Requirements Analysis for ${projectName}`,
          content: analysisContent,
          type: 'requirements-analysis',
          projectName,
          tags: ['requirements', 'analysis', projectName]
        });
      }
      
      // Store in shared state if enabled
      if (this.config.useSharedState && this.sharedState) {
        await this.storeState(['projects', projectName, 'requirements-analysis'], analysis);
      }
      
      logger.info(`Requirements analysis completed for ${projectName}`);
      
      return {
        analysis,
        rawContent: analysisContent
      };
    } catch (error) {
      logger.error(`Error analyzing requirements: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Parse requirements analysis content
   * 
   * @param {string} content - Analysis content
   * @param {string} projectName - Project name
   * @returns {Object} Parsed analysis
   */
  parseRequirementsAnalysis(content, projectName) {
    // Simple parser for markdown sections
    const sections = {};
    let currentSection = 'overview';
    sections[currentSection] = '';
    
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Check for h1, h2, or h3 headers
      if (line.startsWith('# ')) {
        currentSection = line.substring(2).toLowerCase().replace(/[^\w]+/g, '_');
        sections[currentSection] = line + '\n';
      } else if (line.startsWith('## ')) {
        currentSection = line.substring(3).toLowerCase().replace(/[^\w]+/g, '_');
        sections[currentSection] = line + '\n';
      } else if (line.startsWith('### ')) {
        currentSection = line.substring(4).toLowerCase().replace(/[^\w]+/g, '_');
        sections[currentSection] = line + '\n';
      } else {
        sections[currentSection] += line + '\n';
      }
    }
    
    // Extract key findings
    const findings = [];
    
    // Look for findings across all sections
    const findingsPattern = /[-*]\s+(.*?)(?:$|\n)/g;
    let match;
    
    // Check completeness section
    const completenessSection = 
      sections.completeness_assessment || 
      sections.completeness || 
      '';
      
    while ((match = findingsPattern.exec(completenessSection)) !== null) {
      findings.push({
        category: 'completeness',
        description: match[1].trim()
      });
    }
    
    // Check clarity section
    const claritySection = 
      sections.clarity_assessment || 
      sections.clarity || 
      '';
      
    // Reset regex index
    findingsPattern.lastIndex = 0;
    
    while ((match = findingsPattern.exec(claritySection)) !== null) {
      findings.push({
        category: 'clarity',
        description: match[1].trim()
      });
    }
    
    // Check consistency section
    const consistencySection = 
      sections.consistency_check || 
      sections.consistency || 
      '';
      
    // Reset regex index
    findingsPattern.lastIndex = 0;
    
    while ((match = findingsPattern.exec(consistencySection)) !== null) {
      findings.push({
        category: 'consistency',
        description: match[1].trim()
      });
    }
    
    // Extract risks
    const risks = [];
    
    // Check risks section
    const risksSection = 
      sections.risk_assessment || 
      sections.risks || 
      '';
      
    // Reset regex index
    findingsPattern.lastIndex = 0;
    
    while ((match = findingsPattern.exec(risksSection)) !== null) {
      risks.push(match[1].trim());
    }
    
    // Extract recommendations
    const recommendations = [];
    
    // Check recommendations section
    const recommendationsSection = 
      sections.recommendations || 
      '';
      
    // Reset regex index
    findingsPattern.lastIndex = 0;
    
    while ((match = findingsPattern.exec(recommendationsSection)) !== null) {
      recommendations.push(match[1].trim());
    }
    
    // Extract questions
    const questions = [];
    
    // Check questions section
    const questionsSection = 
      sections.questions || 
      '';
      
    // Reset regex index
    findingsPattern.lastIndex = 0;
    
    while ((match = findingsPattern.exec(questionsSection)) !== null) {
      questions.push(match[1].trim());
    }
    
    return {
      title: `Requirements Analysis for ${projectName}`,
      content,
      sections,
      findings,
      risks,
      recommendations,
      questions,
      createdAt: new Date().toISOString()
    };
  }
  
  /**
   * Create a project plan
   * 
   * @param {Object} task - Project planning task
   * @returns {Object} Project plan
   */
  async planProject(task) {
    logger.info('Creating project plan');
    
    if (!task.requirements && !task.prd && !task.taskBreakdown) {
      throw new Error('Task must include requirements, prd, or taskBreakdown field');
    }
    
    const prd = task.prd;
    const taskBreakdown = task.taskBreakdown;
    const requirements = task.requirements || 
      (prd ? prd.requirements : null) || 
      (taskBreakdown ? { tasks: taskBreakdown.tasks } : null);
      
    const projectName = task.projectName || 
      (prd ? prd.title : null) || 
      (taskBreakdown ? taskBreakdown.title.replace('Task Breakdown for ', '') : 'New Project');
      
    // Get timeline preference
    const timeline = task.timeline || {
      startDate: new Date().toISOString().split('T')[0],
      duration: '2 weeks'
    };
    
    // Prepare the prompt for the model
    const prompt = `
# Task: Create Project Plan

## Project Information
- Project Name: ${projectName}
- Timeline: ${typeof timeline === 'object' ? JSON.stringify(timeline, null, 2) : timeline}

## Project Details
${prd ? `# Product Requirements Document\n${prd.content || JSON.stringify(prd, null, 2)}\n\n` : ''}
${taskBreakdown ? `# Task Breakdown\n${taskBreakdown.content || JSON.stringify(taskBreakdown, null, 2)}\n\n` : ''}
${!prd && !taskBreakdown ? `# Requirements\n${typeof requirements === 'object' ? JSON.stringify(requirements, null, 2) : requirements}\n\n` : ''}

## Instructions
Please create a comprehensive project plan based on the provided information. 
Your project plan should include:

1. **Project Overview** - Brief description of the project scope and goals
2. **Timeline** - Detailed timeline with milestones and deadlines
3. **Resource Allocation** - Team members and their responsibilities
4. **Risk Management** - Potential risks and mitigation strategies
5. **Quality Assurance** - Testing approach and quality gates
6. **Communication Plan** - How updates and issues will be communicated
7. **Success Criteria** - How project success will be measured

The plan should be detailed yet practical, with clear milestones and responsibilities.
If certain information is not provided, make reasonable assumptions and note them.
`;
    
    try {
      // Generate project plan
      const planContent = await this.generateText(prompt, {
        temperature: 0.2,
        max_tokens: 5000,
        system_prompt: "You are a Senior Technical Project Manager with expertise in planning and executing software development projects. You excel at creating clear, actionable project plans with realistic timelines, appropriate resource allocation, and effective risk management."
      });
      
      // Parse and structure the project plan
      const projectPlan = this.parseProjectPlan(planContent, projectName);
      
      // Store in knowledge base if enabled
      if (this.config.useKnowledgeBase && this.knowledgeBase) {
        await this.storeKnowledge('project-planning', `project-plan-${task.id}`, {
          title: `Project Plan for ${projectName}`,
          content: planContent,
          type: 'project-plan',
          projectName,
          tags: ['project-plan', 'planning', projectName]
        });
      }
      
      // Store in shared state if enabled
      if (this.config.useSharedState && this.sharedState) {
        await this.storeState(['projects', projectName, 'project-plan'], projectPlan);
      }
      
      logger.info(`Project plan created for ${projectName}`);
      
      return {
        projectPlan,
        rawContent: planContent
      };
    } catch (error) {
      logger.error(`Error creating project plan: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Parse project plan content
   * 
   * @param {string} content - Project plan content
   * @param {string} projectName - Project name
   * @returns {Object} Parsed project plan
   */
  parseProjectPlan(content, projectName) {
    // Simple parser for markdown sections
    const sections = {};
    let currentSection = 'overview';
    sections[currentSection] = '';
    
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Check for h1, h2, or h3 headers
      if (line.startsWith('# ')) {
        currentSection = line.substring(2).toLowerCase().replace(/[^\w]+/g, '_');
        sections[currentSection] = line + '\n';
      } else if (line.startsWith('## ')) {
        currentSection = line.substring(3).toLowerCase().replace(/[^\w]+/g, '_');
        sections[currentSection] = line + '\n';
      } else if (line.startsWith('### ')) {
        currentSection = line.substring(4).toLowerCase().replace(/[^\w]+/g, '_');
        sections[currentSection] = line + '\n';
      } else {
        sections[currentSection] += line + '\n';
      }
    }
    
    // Extract milestones
    const milestones = [];
    
    // Look for milestones section
    const milestonesSection = 
      sections.milestones || 
      sections.timeline || 
      '';
      
    const milestonePattern = /[-*]\s+(?:\*\*)?([^:]+)(?:\*\*)?\s*:\s*(.*?)(?:$|\n)/g;
    let match;
    
    while ((match = milestonePattern.exec(milestonesSection)) !== null) {
      milestones.push({
        name: match[1].trim(),
        description: match[2].trim()
      });
    }
    
    // Extract risks
    const risks = [];
    
    // Check risks section
    const risksSection = 
      sections.risks || 
      sections.risk_management || 
      '';
      
    // Reset regex index
    const risksPattern = /[-*]\s+(.*?)(?:$|\n)/g;
    
    while ((match = risksPattern.exec(risksSection)) !== null) {
      risks.push(match[1].trim());
    }
    
    // Extract team members
    const team = [];
    
    // Check team section
    const teamSection = 
      sections.team || 
      sections.resource_allocation || 
      '';
      
    // Reset regex index
    const teamPattern = /[-*]\s+(?:\*\*)?([^:]+)(?:\*\*)?\s*:\s*(.*?)(?:$|\n)/g;
    
    while ((match = teamPattern.exec(teamSection)) !== null) {
      team.push({
        role: match[1].trim(),
        responsibilities: match[2].trim()
      });
    }
    
    // Extract success criteria
    const successCriteria = [];
    
    // Check success criteria section
    const criteriaSection = 
      sections.success_criteria || 
      '';
      
    // Reset regex index
    const criteriaPattern = /[-*]\s+(.*?)(?:$|\n)/g;
    
    while ((match = criteriaPattern.exec(criteriaSection)) !== null) {
      successCriteria.push(match[1].trim());
    }
    
    return {
      title: `Project Plan for ${projectName}`,
      content,
      sections,
      milestones,
      risks,
      team,
      successCriteria,
      createdAt: new Date().toISOString()
    };
  }
}

// Default templates
const DEFAULT_PRD_TEMPLATE = `
# Product Requirements Document

## 1. Introduction
- Project Overview
- Goals and Objectives
- Stakeholders

## 2. Product Overview
- Description
- Key Features
- User Personas

## 3. Functional Requirements
- [List of functional requirements]

## 4. Non-Functional Requirements
- Performance Requirements
- Security Requirements
- Scalability Requirements
- Usability Requirements

## 5. User Stories
- [User stories in the format: "As a [user], I want to [action] so that [benefit]"]

## 6. Technical Requirements
- Frontend Stack
- Backend Stack
- Database
- APIs/Integrations
- Deployment Environment

## 7. User Interface
- Design Guidelines
- Key Screens/Interfaces
- Navigation Flow

## 8. Data Requirements
- Data Entities
- Data Relationships
- Data Validation Rules

## 9. Assumptions and Constraints
- Technical Constraints
- Business Constraints
- Assumptions

## 10. Success Criteria
- Acceptance Criteria
- Key Performance Indicators

## 11. Timeline and Milestones
- Development Phases
- Key Deliverables

## 12. Appendix
- Glossary
- References
- Supporting Documents
`;

const DEFAULT_ARCHITECTURE_TEMPLATE = `
# System Architecture Document

## 1. Architecture Overview
- High-Level Architecture
- System Context
- Key Design Decisions

## 2. Components
- Frontend Components
- Backend Components
- Database Components
- Third-Party Services/Integrations

## 3. Data Flow
- Main Data Flows
- Process Diagrams
- Integration Points

## 4. Data Model
- Entity Definitions
- Relationships
- Database Schema

## 5. API Specifications
- API Endpoints
- Request/Response Formats
- Authentication/Authorization

## 6. Security Architecture
- Authentication Mechanism
- Authorization Strategy
- Data Protection
- Security Controls

## 7. Performance Considerations
- Scalability Approach
- Caching Strategy
- Performance Optimization Techniques

## 8. Deployment Architecture
- Deployment Environment
- Infrastructure Components
- CI/CD Pipeline

## 9. Monitoring and Logging
- Monitoring Approach
- Logging Strategy
- Alerting Mechanisms

## 10. Disaster Recovery
- Backup Strategy
- Recovery Approach
- Redundancy Measures
`;

const DEFAULT_API_SPEC_TEMPLATE = `
# API Specifications

## 1. API Overview
- Purpose and Scope
- Base URL
- Versioning Strategy
- Authentication Method

## 2. Common Conventions
- Request/Response Format
- HTTP Methods Usage
- Status Codes
- Error Handling
- Pagination Approach

## 3. Authentication and Authorization
- Authentication Mechanism
- Authorization Levels
- Token Management
- Security Considerations

## 4. Endpoints
[For each endpoint, provide the following information:]
- HTTP Method and Path
- Description
- Request Parameters
- Request Body
- Response Format
- Status Codes
- Example Request/Response

## 5. Data Models
- Schema Definitions
- Data Types
- Validation Rules

## 6. Rate Limiting
- Limits by Endpoint
- Rate Limiting Strategy
- Exceeding Limit Behavior

## 7. Webhooks (if applicable)
- Event Types
- Payload Format
- Security Considerations

## 8. Versioning and Deprecation
- Versioning Strategy
- Deprecation Policy
- Migration Guidelines

## 9. Error Codes and Messages
- Standard Error Codes
- Error Response Format
- Troubleshooting Guidelines
`;

const DEFAULT_DATA_MODEL_TEMPLATE = `
# Data Model

## 1. Overview
- Purpose and Scope
- Data Model Approach
- Key Entities

## 2. Entities
[For each entity, provide the following information:]
- Entity Name
- Description
- Fields (name, type, constraints, description)
- Primary Key
- Relationships
- Indexes
- Constraints

## 3. Relationships
- Entity Relationships
- Cardinality
- Referential Integrity Rules

## 4. Database Specifics
- Database Type
- Schema Design
- Normalization/Denormalization Strategy
- Partitioning Strategy (if applicable)

## 5. Data Access Patterns
- Common Queries
- Performance Considerations
- Indexing Strategy

## 6. Data Migration
- Migration Strategy
- Data Transformation Rules
- Validation Checks

## 7. Data Validation
- Validation Rules
- Constraints
- Data Quality Measures

## 8. Data Security
- Access Control
- Data Encryption
- Privacy Considerations
`;

const DEFAULT_TASK_BREAKDOWN_TEMPLATE = `
# Task Breakdown

## 1. Overview
- Project Summary
- Approach
- Dependencies

## 2. Phases
- Phase 1: [Name] (Tasks #1-3)
- Phase 2: [Name] (Tasks #4-7)
- Phase 3: [Name] (Tasks #8-10)

## 3. Tasks
[For each task, provide the following information:]

### Task 1: [Task Title]
- Description: [Detailed description of what needs to be done]
- Role: [Who is responsible]
- Effort: [Estimated effort or time]
- Dependencies: [Tasks that must be completed before this one]

### Task 2: [Task Title]
- Description: [Detailed description of what needs to be done]
- Role: [Who is responsible]
- Effort: [Estimated effort or time]
- Dependencies: [Tasks that must be completed before this one]

[Continue for all tasks]

## 4. Timeline Considerations
- Critical Path
- Parallel Execution Opportunities
- Potential Bottlenecks

## 5. Assumptions
- Task Assumptions
- Resource Assumptions
- Timeline Assumptions
`;

module.exports = PlanningAgent;
