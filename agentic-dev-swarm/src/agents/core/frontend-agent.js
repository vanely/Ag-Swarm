/**
 * Frontend Development Agent for the Agentic Software Development Swarm
 * 
 * This agent is responsible for building React components, admin interfaces,
 * user dashboards, implementing responsive design and accessibility standards,
 * and integrating with backend APIs.
 */

const fs = require('fs').promises;
const path = require('path');
const BaseAgent = require('../base-agent');
const logger = require('../../utils/logger');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class FrontendAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      type: 'frontend',
      name: 'Frontend Development Agent',
      specializations: [
        'react',
        'ui-components',
        'responsive-design',
        'css',
        'frontend-integration',
        'accessibility',
        'frontend-testing'
      ],
      capabilities: [
        'component-development',
        'ui-implementation',
        'api-integration',
        'form-handling',
        'state-management',
        'responsive-layout',
        'accessibility-compliance',
        'frontend-testing'
      ],
      model: config.model || 'gpt-5', // Default to GPT-5 for frontend tasks
      ...config
    });
    
    this.templatePath = config.templatePath || path.join(__dirname, '../../templates/frontend');
    this.templates = new Map();
    
    // Framework preferences
    this.defaultFramework = config.defaultFramework || 'react';
    this.defaultStyleSystem = config.defaultStyleSystem || 'tailwind';
    this.defaultStateManagement = config.defaultStateManagement || 'react-hooks';
    
    // Component repository
    this.componentRepository = new Map();
    
    logger.info('Frontend Development Agent initialized');
  }
  
  /**
   * Initialize the agent
   */
  async initialize() {
    await super.initialize();
    
    try {
      // Load templates
      await this.loadTemplates();
      
      // Initialize component repository from knowledge base if available
      if (this.config.useKnowledgeBase && this.knowledgeBase) {
        await this.initializeComponentRepository();
      }
      
      logger.info(`Frontend Agent ${this.config.id} ready with ${this.templates.size} templates`);
      
      return true;
    } catch (error) {
      logger.error(`Error initializing Frontend Agent: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Load frontend templates
   */
  async loadTemplates() {
    try {
      // Check if template directory exists
      try {
        await fs.access(this.templatePath);
      } catch (error) {
        logger.warn(`Template directory ${this.templatePath} not found, using default templates`);
        
        // Use default templates if directory doesn't exist
        this.templates.set('react-component', DEFAULT_REACT_COMPONENT_TEMPLATE);
        this.templates.set('react-page', DEFAULT_REACT_PAGE_TEMPLATE);
        this.templates.set('react-hook', DEFAULT_REACT_HOOK_TEMPLATE);
        this.templates.set('css-module', DEFAULT_CSS_MODULE_TEMPLATE);
        this.templates.set('test-component', DEFAULT_TEST_COMPONENT_TEMPLATE);
        
        return;
      }
      
      // Read framework-specific directories
      const frameworks = await fs.readdir(this.templatePath);
      
      for (const framework of frameworks) {
        const frameworkPath = path.join(this.templatePath, framework);
        const stats = await fs.stat(frameworkPath);
        
        if (!stats.isDirectory()) continue;
        
        // Read template files in the framework directory
        const files = await fs.readdir(frameworkPath);
        
        for (const file of files) {
          const templatePath = path.join(frameworkPath, file);
          const templateName = `${framework}-${path.basename(file, path.extname(file))}`;
          
          try {
            const content = await fs.readFile(templatePath, 'utf8');
            this.templates.set(templateName, content);
            
            logger.debug(`Loaded template: ${templateName}`);
          } catch (error) {
            logger.error(`Error loading template ${templatePath}: ${error.message}`);
          }
        }
      }
      
      // If no templates were found, use default templates
      if (this.templates.size === 0) {
        logger.warn('No templates found, using default templates');
        
        this.templates.set('react-component', DEFAULT_REACT_COMPONENT_TEMPLATE);
        this.templates.set('react-page', DEFAULT_REACT_PAGE_TEMPLATE);
        this.templates.set('react-hook', DEFAULT_REACT_HOOK_TEMPLATE);
        this.templates.set('css-module', DEFAULT_CSS_MODULE_TEMPLATE);
        this.templates.set('test-component', DEFAULT_TEST_COMPONENT_TEMPLATE);
      }
    } catch (error) {
      logger.error(`Error loading templates: ${error.message}`);
      
      // Use default templates as fallback
      this.templates.set('react-component', DEFAULT_REACT_COMPONENT_TEMPLATE);
      this.templates.set('react-page', DEFAULT_REACT_PAGE_TEMPLATE);
      this.templates.set('react-hook', DEFAULT_REACT_HOOK_TEMPLATE);
      this.templates.set('css-module', DEFAULT_CSS_MODULE_TEMPLATE);
      this.templates.set('test-component', DEFAULT_TEST_COMPONENT_TEMPLATE);
    }
  }
  
  /**
   * Initialize component repository from knowledge base
   */
  async initializeComponentRepository() {
    try {
      // Search for components in the knowledge base
      const results = await this.knowledgeBase.search('type:component', {
        categories: ['frontend-components']
      });
      
      // Add components to repository
      for (const result of results) {
        if (result.entry && result.entry.code) {
          this.componentRepository.set(result.key, result.entry);
          logger.debug(`Added component to repository: ${result.key}`);
        }
      }
      
      logger.info(`Initialized component repository with ${this.componentRepository.size} components`);
    } catch (error) {
      logger.error(`Error initializing component repository: ${error.message}`);
    }
  }
  
  /**
   * Process a task
   * 
   * @param {Object} task - Task to process
   * @returns {Object} Task result
   */
  async processTask(task) {
    logger.info(`Frontend Agent processing task: ${task.type || 'unknown'}`);
    
    switch (task.type) {
      case 'create-component':
        return await this.createComponent(task);
        
      case 'create-page':
        return await this.createPage(task);
        
      case 'implement-feature':
        return await this.implementFeature(task);
        
      case 'style-component':
        return await this.styleComponent(task);
        
      case 'integrate-api':
        return await this.integrateAPI(task);
        
      case 'implement-form':
        return await this.implementForm(task);
        
      case 'create-hook':
        return await this.createHook(task);
        
      case 'add-test':
        return await this.addTest(task);
        
      case 'fix-issue':
        return await this.fixIssue(task);
        
      default:
        throw new Error(`Unsupported task type: ${task.type || 'undefined'}`);
    }
  }
  
  /**
   * Create a React component
   * 
   * @param {Object} task - Component creation task
   * @returns {Object} Created component
   */
  async createComponent(task) {
    logger.info('Creating component');
    
    if (!task.name) {
      throw new Error('Task must include component name');
    }
    
    const name = task.name;
    const description = task.description || `${name} component`;
    const props = task.props || [];
    const type = task.componentType || 'functional';
    const framework = task.framework || this.defaultFramework;
    const styleSystem = task.styleSystem || this.defaultStyleSystem;
    const includeStorybook = task.includeStorybook !== false;
    const includeTest = task.includeTest !== false;
    
    // Get appropriate template
    const templateKey = `${framework}-component`;
    let template = this.templates.get(templateKey) || DEFAULT_REACT_COMPONENT_TEMPLATE;
    
    // Prepare the prompt for the model
    const prompt = this.prepareComponentPrompt(
      name,
      description,
      props,
      type,
      framework,
      styleSystem,
      template,
      task
    );
    
    try {
      // Generate component code
      const componentCode = await this.generateText(prompt, {
        temperature: 0.2,
        max_tokens: 3000,
        system_prompt: "You are an expert React frontend developer with deep understanding of modern JavaScript frameworks, component patterns, and best practices. You write clean, maintainable, well-documented, and accessible components that follow established conventions."
      });
      
      // Parse result to get component code and other assets
      const result = this.parseComponentResult(componentCode);
      
      // Create the component file
      let componentFilePath = '';
      
      if (task.outputPath) {
        // Ensure output directory exists
        await fs.mkdir(task.outputPath, { recursive: true });
        
        // Determine file extension
        const fileExtension = framework === 'react' ? 
          (task.typescript ? '.tsx' : '.jsx') : '.js';
          
        // Write component file
        componentFilePath = path.join(task.outputPath, `${name}${fileExtension}`);
        await fs.writeFile(componentFilePath, result.component);
        
        // Write style file if present
        if (result.styles) {
          const styleExtension = styleSystem === 'css-modules' ? 
            '.module.css' : (styleSystem === 'scss' ? '.scss' : '.css');
            
          const stylePath = path.join(task.outputPath, `${name}${styleExtension}`);
          await fs.writeFile(stylePath, result.styles);
        }
        
        // Write test file if present and requested
        if (result.test && includeTest) {
          const testDir = path.join(task.outputPath, '__tests__');
          await fs.mkdir(testDir, { recursive: true });
          
          const testPath = path.join(testDir, `${name}.test${fileExtension}`);
          await fs.writeFile(testPath, result.test);
        }
        
        // Write Storybook file if present and requested
        if (result.storybook && includeStorybook) {
          const storybookDir = path.join(task.outputPath, '__stories__');
          await fs.mkdir(storybookDir, { recursive: true });
          
          const storybookPath = path.join(storybookDir, `${name}.stories${fileExtension}`);
          await fs.writeFile(storybookPath, result.storybook);
        }
        
        logger.info(`Component files written to ${task.outputPath}`);
      }
      
      // Store in knowledge base if enabled
      if (this.config.useKnowledgeBase && this.knowledgeBase) {
        const componentEntry = {
          name,
          description,
          code: result.component,
          styles: result.styles,
          test: result.test,
          storybook: result.storybook,
          props,
          type,
          framework,
          styleSystem,
          createdAt: new Date().toISOString()
        };
        
        await this.storeKnowledge('frontend-components', `component-${name}`, componentEntry);
        
        // Add to component repository
        this.componentRepository.set(`component-${name}`, componentEntry);
      }
      
      logger.info(`Component ${name} created successfully`);
      
      return {
        name,
        description,
        component: result.component,
        styles: result.styles,
        test: result.test,
        storybook: result.storybook,
        filePath: componentFilePath
      };
    } catch (error) {
      logger.error(`Error creating component: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Prepare prompt for component creation
   * 
   * @param {string} name - Component name
   * @param {string} description - Component description
   * @param {Array} props - Component props
   * @param {string} type - Component type (functional/class)
   * @param {string} framework - Framework to use
   * @param {string} styleSystem - Styling system to use
   * @param {string} template - Component template
   * @param {Object} task - Original task with additional context
   * @returns {string} Prepared prompt
   */
  prepareComponentPrompt(name, description, props, type, framework, styleSystem, template, task) {
    // Format props for display
    const propsText = props.length > 0 ? 
      JSON.stringify(props, null, 2) : 'No specific props defined';
    
    // Additional context from task
    const contextItems = [];
    
    if (task.designSpec) contextItems.push(`Design Spec: ${JSON.stringify(task.designSpec, null, 2)}`);
    if (task.accessibility) contextItems.push(`Accessibility Requirements: ${task.accessibility}`);
    if (task.responsive) contextItems.push(`Responsive Requirements: ${task.responsive}`);
    if (task.dependencies) contextItems.push(`Dependencies: ${JSON.stringify(task.dependencies, null, 2)}`);
    if (task.apiIntegration) contextItems.push(`API Integration: ${JSON.stringify(task.apiIntegration, null, 2)}`);
    
    const contextText = contextItems.length > 0 ? 
      `\n\n## Additional Context\n${contextItems.join('\n\n')}` : '';
    
    return `
# Task: Create React Component

## Component Information
- Name: ${name}
- Description: ${description}
- Type: ${type} component
- Framework: ${framework}
- Styling: ${styleSystem}
- TypeScript: ${task.typescript ? 'Yes' : 'No'}
${task.parentComponent ? `- Parent Component: ${task.parentComponent}` : ''}

## Props
${propsText}
${contextText}

## Instructions
Please create a ${type} ${framework} component based on the information provided.
Follow these guidelines:

1. Use the ${styleSystem} styling approach
2. Include PropTypes or TypeScript type definitions
3. Add JSDoc comments for the component and props
4. Make the component accessible and follow ARIA best practices
5. Implement responsive design principles
6. Include reasonable default props
7. Optimize for performance (memoization where appropriate)
8. Return a clean separation of component, styles, tests, and stories

## Template Structure (adapt as needed)
${template}

## Expected Response Format
Please provide your response in the following format:

\`\`\`component
// Component code here
\`\`\`

${styleSystem !== 'inline' ? 
`\`\`\`styles
// Styles code here
\`\`\`` : ''}

\`\`\`test
// Test code here
\`\`\`

\`\`\`storybook
// Storybook stories here
\`\`\`
`;
  }
  
  /**
   * Parse the result of component generation
   * 
   * @param {string} result - Raw model output
   * @returns {Object} Parsed result with component parts
   */
  parseComponentResult(result) {
    // Parse the different code blocks from the result
    const parsed = {
      component: '',
      styles: '',
      test: '',
      storybook: ''
    };
    
    // Extract component code
    const componentMatch = result.match(/```component\n([\s\S]*?)```/);
    if (componentMatch) {
      parsed.component = componentMatch[1].trim();
    } else {
      // If no component marker, look for first code block
      const codeMatch = result.match(/```(?:jsx|tsx|js|ts)?\n([\s\S]*?)```/);
      if (codeMatch) {
        parsed.component = codeMatch[1].trim();
      } else {
        logger.warn('No component code block found in result');
      }
    }
    
    // Extract styles code
    const stylesMatch = result.match(/```styles\n([\s\S]*?)```/) || 
      result.match(/```(?:css|scss|less)\n([\s\S]*?)```/);
      
    if (stylesMatch) {
      parsed.styles = stylesMatch[1].trim();
    }
    
    // Extract test code
    const testMatch = result.match(/```test\n([\s\S]*?)```/) || 
      result.match(/```(?:test|jest)\n([\s\S]*?)```/);
      
    if (testMatch) {
      parsed.test = testMatch[1].trim();
    }
    
    // Extract storybook code
    const storybookMatch = result.match(/```storybook\n([\s\S]*?)```/) || 
      result.match(/```(?:story|stories)\n([\s\S]*?)```/);
      
    if (storybookMatch) {
      parsed.storybook = storybookMatch[1].trim();
    }
    
    return parsed;
  }
  
  /**
   * Create a page component
   * 
   * @param {Object} task - Page creation task
   * @returns {Object} Created page
   */
  async createPage(task) {
    logger.info('Creating page component');
    
    if (!task.name) {
      throw new Error('Task must include page name');
    }
    
    const name = task.name;
    const description = task.description || `${name} page`;
    const route = task.route || `/${name.toLowerCase().replace(/\s+/g, '-')}`;
    const components = task.components || [];
    const framework = task.framework || this.defaultFramework;
    const styleSystem = task.styleSystem || this.defaultStyleSystem;
    const stateManagement = task.stateManagement || this.defaultStateManagement;
    
    // Get appropriate template
    const templateKey = `${framework}-page`;
    let template = this.templates.get(templateKey) || DEFAULT_REACT_PAGE_TEMPLATE;
    
    // Prepare the prompt for the model
    const prompt = this.preparePagePrompt(
      name,
      description,
      route,
      components,
      framework,
      styleSystem,
      stateManagement,
      template,
      task
    );
    
    try {
      // Generate page code
      const pageCode = await this.generateText(prompt, {
        temperature: 0.2,
        max_tokens: 4000,
        system_prompt: "You are an expert frontend developer with deep understanding of modern JavaScript frameworks, page structure, routing, and state management. You write clean, maintainable, well-organized, and responsive pages that follow best practices and integrate well with application architecture."
      });
      
      // Parse result to get page code and other assets
      const result = this.parseComponentResult(pageCode); // Reuse component parser
      
      // Create the page file
      let pageFilePath = '';
      
      if (task.outputPath) {
        // Ensure output directory exists
        await fs.mkdir(task.outputPath, { recursive: true });
        
        // Determine file extension
        const fileExtension = framework === 'react' ? 
          (task.typescript ? '.tsx' : '.jsx') : '.js';
          
        // Format page name to follow conventions (PascalCase + Page suffix if not present)
        let formattedName = name;
        if (!formattedName.endsWith('Page')) {
          formattedName += 'Page';
        }
        
        // Write page file
        pageFilePath = path.join(task.outputPath, `${formattedName}${fileExtension}`);
        await fs.writeFile(pageFilePath, result.component);
        
        // Write style file if present
        if (result.styles) {
          const styleExtension = styleSystem === 'css-modules' ? 
            '.module.css' : (styleSystem === 'scss' ? '.scss' : '.css');
            
          const stylePath = path.join(task.outputPath, `${formattedName}${styleExtension}`);
          await fs.writeFile(stylePath, result.styles);
        }
        
        // Write test file if present
        if (result.test) {
          const testDir = path.join(task.outputPath, '__tests__');
          await fs.mkdir(testDir, { recursive: true });
          
          const testPath = path.join(testDir, `${formattedName}.test${fileExtension}`);
          await fs.writeFile(testPath, result.test);
        }
        
        logger.info(`Page files written to ${task.outputPath}`);
      }
      
      // Store in knowledge base if enabled
      if (this.config.useKnowledgeBase && this.knowledgeBase) {
        await this.storeKnowledge('frontend-pages', `page-${name}`, {
          name,
          description,
          route,
          code: result.component,
          styles: result.styles,
          test: result.test,
          components,
          framework,
          styleSystem,
          stateManagement,
          createdAt: new Date().toISOString()
        });
      }
      
      logger.info(`Page ${name} created successfully`);
      
      return {
        name,
        description,
        route,
        component: result.component,
        styles: result.styles,
        test: result.test,
        filePath: pageFilePath
      };
    } catch (error) {
      logger.error(`Error creating page: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Prepare prompt for page creation
   * 
   * @param {string} name - Page name
   * @param {string} description - Page description
   * @param {string} route - Page route
   * @param {Array} components - Components used on the page
   * @param {string} framework - Framework to use
   * @param {string} styleSystem - Styling system to use
   * @param {string} stateManagement - State management approach
   * @param {string} template - Page template
   * @param {Object} task - Original task with additional context
   * @returns {string} Prepared prompt
   */
  preparePagePrompt(name, description, route, components, framework, styleSystem, stateManagement, template, task) {
    // Format components for display
    const componentsText = components.length > 0 ? 
      JSON.stringify(components, null, 2) : 'No specific components defined';
    
    // Additional context from task
    const contextItems = [];
    
    if (task.designSpec) contextItems.push(`Design Spec: ${JSON.stringify(task.designSpec, null, 2)}`);
    if (task.layout) contextItems.push(`Layout: ${task.layout}`);
    if (task.dataRequirements) contextItems.push(`Data Requirements: ${JSON.stringify(task.dataRequirements, null, 2)}`);
    if (task.apiEndpoints) contextItems.push(`API Endpoints: ${JSON.stringify(task.apiEndpoints, null, 2)}`);
    if (task.authentication) contextItems.push(`Authentication Requirements: ${task.authentication}`);
    
    const contextText = contextItems.length > 0 ? 
      `\n\n## Additional Context\n${contextItems.join('\n\n')}` : '';
      
    // Get component code from repository if available
    let componentCodeText = '';
    
    if (components.length > 0 && this.componentRepository.size > 0) {
      const componentCodes = [];
      
      for (const component of components) {
        const componentName = typeof component === 'string' ? component : component.name;
        const componentEntry = this.componentRepository.get(`component-${componentName}`);
        
        if (componentEntry && componentEntry.code) {
          componentCodes.push(`### ${componentName} Component\n\`\`\`jsx\n${componentEntry.code}\n\`\`\``);
        }
      }
      
      if (componentCodes.length > 0) {
        componentCodeText = `\n\n## Available Component Code\n${componentCodes.join('\n\n')}`;
      }
    }
    
    return `
# Task: Create Page Component

## Page Information
- Name: ${name}
- Description: ${description}
- Route: ${route}
- Framework: ${framework}
- Styling: ${styleSystem}
- State Management: ${stateManagement}
- TypeScript: ${task.typescript ? 'Yes' : 'No'}

## Components to Include
${componentsText}
${contextText}
${componentCodeText}

## Instructions
Please create a ${framework} page component based on the information provided.
Follow these guidelines:

1. Structure the page with appropriate layout and sections
2. Import and use the specified components
3. Implement ${stateManagement} for state management
4. Use the ${styleSystem} styling approach
5. Add proper routing configuration
6. Include data fetching logic where needed
7. Implement responsive design principles
8. Add appropriate loading and error states
9. Consider performance optimization
10. Return a clean separation of page component, styles, and tests

## Template Structure (adapt as needed)
${template}

## Expected Response Format
Please provide your response in the following format:

\`\`\`component
// Page component code here
\`\`\`

${styleSystem !== 'inline' ? 
`\`\`\`styles
// Styles code here
\`\`\`` : ''}

\`\`\`test
// Test code here
\`\`\`
`;
  }
  
  /**
   * Implement a frontend feature
   * 
   * @param {Object} task - Feature implementation task
   * @returns {Object} Implemented feature
   */
  async implementFeature(task) {
    logger.info('Implementing frontend feature');
    
    if (!task.feature) {
      throw new Error('Task must include feature description');
    }
    
    const feature = task.feature;
    const components = task.components || [];
    const pages = task.pages || [];
    const framework = task.framework || this.defaultFramework;
    const stateManagement = task.stateManagement || this.defaultStateManagement;
    
    // Prepare the prompt for the model
    const prompt = this.prepareFeaturePrompt(
      feature,
      components,
      pages,
      framework,
      stateManagement,
      task
    );
    
    try {
      // Generate feature implementation plan
      const featureImplementation = await this.generateText(prompt, {
        temperature: 0.3,
        max_tokens: 4000,
        system_prompt: "You are an experienced frontend developer with expertise in feature implementation, architecture, and project organization. You provide clear, practical solutions with well-structured code and detailed implementation plans."
      });
      
      // Parse feature implementation plan
      const result = this.parseFeatureImplementation(featureImplementation, feature);
      
      // Create feature files if output path provided
      if (task.outputPath) {
        await this.createFeatureFiles(result, task.outputPath, framework, task.typescript);
      }
      
      // Store in knowledge base if enabled
      if (this.config.useKnowledgeBase && this.knowledgeBase) {
        await this.storeKnowledge('frontend-features', `feature-${this.sanitizeFileName(feature)}`, {
          feature,
          implementation: result,
          components,
          pages,
          framework,
          stateManagement,
          createdAt: new Date().toISOString()
        });
      }
      
      logger.info(`Feature "${feature}" implementation plan created successfully`);
      
      return {
        feature,
        implementation: result
      };
    } catch (error) {
      logger.error(`Error implementing feature: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Prepare prompt for feature implementation
   * 
   * @param {string} feature - Feature description
   * @param {Array} components - Components involved
   * @param {Array} pages - Pages involved
   * @param {string} framework - Framework to use
   * @param {string} stateManagement - State management approach
   * @param {Object} task - Original task with additional context
   * @returns {string} Prepared prompt
   */
  prepareFeaturePrompt(feature, components, pages, framework, stateManagement, task) {
    // Format components and pages for display
    const componentsText = components.length > 0 ? 
      JSON.stringify(components, null, 2) : 'No specific components defined';
    
    const pagesText = pages.length > 0 ? 
      JSON.stringify(pages, null, 2) : 'No specific pages defined';
    
    // Additional context from task
    const contextItems = [];
    
    if (task.userStories) contextItems.push(`User Stories: ${JSON.stringify(task.userStories, null, 2)}`);
    if (task.acceptance) contextItems.push(`Acceptance Criteria: ${JSON.stringify(task.acceptance, null, 2)}`);
    if (task.api) contextItems.push(`API Integration: ${JSON.stringify(task.api, null, 2)}`);
    if (task.architecture) contextItems.push(`Architecture: ${task.architecture}`);
    
    const contextText = contextItems.length > 0 ? 
      `\n\n## Additional Context\n${contextItems.join('\n\n')}` : '';
    
    return `
# Task: Implement Frontend Feature

## Feature Information
- Feature: ${feature}
- Framework: ${framework}
- State Management: ${stateManagement}
- TypeScript: ${task.typescript ? 'Yes' : 'No'}

## Components Involved
${componentsText}

## Pages Involved
${pagesText}
${contextText}

## Instructions
Please create an implementation plan and code for the frontend feature based on the information provided.
Your response should include:

1. Feature Overview - A summary of the feature and its purpose
2. Implementation Strategy - How to structure the feature implementation
3. Component Changes - Code for new or updated components
4. State Management - How state will be organized
5. API Integration - How to connect with any required backend services
6. Routing Changes - Any updates to routing configuration
7. Tests - Test cases for the feature
8. Dependencies - Any new dependencies required

## Expected Response Format
Please provide your response with clear section headers and code blocks for each implementation file.
For each code file, use the format:

\`\`\`filename: path/to/file.js
// Code content here
\`\`\`
`;
  }
  
  /**
   * Parse feature implementation result
   * 
   * @param {string} content - Raw implementation content
   * @param {string} feature - Feature name
   * @returns {Object} Parsed implementation
   */
  parseFeatureImplementation(content, feature) {
    // Extract file contents from code blocks
    const fileRegex = /```(?:filename: )?([\w\/\.-]+)(?:\n|\r\n)([\s\S]*?)```/g;
    const files = [];
    
    let match;
    while ((match = fileRegex.exec(content)) !== null) {
      const filePath = match[1].trim();
      const fileContent = match[2].trim();
      
      files.push({
        path: filePath,
        content: fileContent
      });
    }
    
    // Parse markdown sections
    const sections = {};
    let currentSection = 'overview';
    sections[currentSection] = '';
    
    const lines = content.split('\n');
    let inCodeBlock = false;
    
    for (const line of lines) {
      // Skip code blocks for section parsing
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      
      if (inCodeBlock) continue;
      
      // Check for headers
      if (line.startsWith('# ')) {
        currentSection = line.substring(2).toLowerCase().replace(/[^\w]+/g, '_');
        sections[currentSection] = line + '\n';
      } else if (line.startsWith('## ')) {
        currentSection = line.substring(3).toLowerCase().replace(/[^\w]+/g, '_');
        sections[currentSection] = line + '\n';
      } else {
        sections[currentSection] += line + '\n';
      }
    }
    
    return {
      feature,
      files,
      sections,
      content
    };
  }
  
  /**
   * Create files for feature implementation
   * 
   * @param {Object} implementation - Parsed implementation
   * @param {string} outputPath - Base output path
   * @param {string} framework - Framework being used
   * @param {boolean} useTypescript - Whether to use TypeScript
   */
  async createFeatureFiles(implementation, outputPath, framework, useTypescript) {
    // Ensure output directory exists
    await fs.mkdir(outputPath, { recursive: true });
    
    // Create each file
    for (const file of implementation.files) {
      try {
        // Get directory from file path
        const filePath = file.path;
        const dirPath = path.dirname(path.join(outputPath, filePath));
        
        // Ensure directory exists
        await fs.mkdir(dirPath, { recursive: true });
        
        // Write file
        const fullPath = path.join(outputPath, filePath);
        await fs.writeFile(fullPath, file.content);
        
        logger.debug(`Created file: ${fullPath}`);
      } catch (error) {
        logger.error(`Error creating file ${file.path}: ${error.message}`);
      }
    }
    
    // Create a README with the implementation overview
    const readmePath = path.join(outputPath, 'README.md');
    const readmeContent = `# ${implementation.feature} Implementation\n\n${implementation.content}`;
    
    await fs.writeFile(readmePath, readmeContent);
    
    logger.info(`Feature files written to ${outputPath}`);
  }
  
  /**
   * Sanitize a string to use as a file name
   * 
   * @param {string} name - Name to sanitize
   * @returns {string} Sanitized name
   */
  sanitizeFileName(name) {
    return name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')  // Remove special characters
      .replace(/\s+/g, '-')      // Replace spaces with hyphens
      .replace(/-+/g, '-');      // Collapse multiple hyphens
  }
  
  /**
   * Style a component
   * 
   * @param {Object} task - Component styling task
   * @returns {Object} Styling result
   */
  async styleComponent(task) {
    logger.info('Styling component');
    
    if (!task.component) {
      throw new Error('Task must include component code or name');
    }
    
    // Get component code
    let componentCode = task.component;
    let componentName = task.name;
    
    // If component is a string name, try to find it in the repository
    if (typeof componentCode === 'string' && !componentCode.includes('import') && !componentCode.includes('function')) {
      componentName = componentCode;
      
      const componentEntry = this.componentRepository.get(`component-${componentName}`);
      
      if (componentEntry && componentEntry.code) {
        componentCode = componentEntry.code;
      } else {
        throw new Error(`Component ${componentName} not found in repository`);
      }
    }
    
    const styleSystem = task.styleSystem || this.defaultStyleSystem;
    const designSpec = task.designSpec || 'Create a clean, modern design with appropriate spacing, colors, and typography.';
    
    // Prepare the prompt for the model
    const prompt = this.prepareStylePrompt(
      componentCode,
      componentName,
      styleSystem,
      designSpec,
      task
    );
    
    try {
      // Generate styling code
      const stylingResult = await this.generateText(prompt, {
        temperature: 0.3,
        max_tokens: 3000,
        system_prompt: "You are an expert frontend developer specializing in UI design, CSS, and component styling. You create clean, elegant, accessible styles that follow modern design principles and best practices."
      });
      
      // Parse result
      const result = this.parseStyleResult(stylingResult, styleSystem);
      
      // Create style files if output path provided
      if (task.outputPath) {
        await this.createStyleFiles(result, task.outputPath, componentName, styleSystem);
      }
      
      // Update component in repository if available
      if (componentName && this.componentRepository.has(`component-${componentName}`)) {
        const component = this.componentRepository.get(`component-${componentName}`);
        
        component.styles = result.styles;
        component.updatedComponent = result.component;
        
        this.componentRepository.set(`component-${componentName}`, component);
        
        // Update in knowledge base if enabled
        if (this.config.useKnowledgeBase && this.knowledgeBase) {
          await this.storeKnowledge('frontend-components', `component-${componentName}`, component);
        }
      }
      
      logger.info(`Component ${componentName || 'unknown'} styled successfully`);
      
      return {
        componentName,
        component: result.component,
        styles: result.styles,
        preview: result.preview
      };
    } catch (error) {
      logger.error(`Error styling component: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Prepare prompt for component styling
   * 
   * @param {string} componentCode - Component code
   * @param {string} componentName - Component name
   * @param {string} styleSystem - Styling system to use
   * @param {string} designSpec - Design specifications
   * @param {Object} task - Original task with additional context
   * @returns {string} Prepared prompt
   */
  prepareStylePrompt(componentCode, componentName, styleSystem, designSpec, task) {
    // Additional context from task
    const contextItems = [];
    
    if (task.theme) contextItems.push(`Theme: ${JSON.stringify(task.theme, null, 2)}`);
    if (task.responsive) contextItems.push(`Responsive Requirements: ${task.responsive}`);
    if (task.accessibility) contextItems.push(`Accessibility Requirements: ${task.accessibility}`);
    if (task.animations) contextItems.push(`Animations: ${task.animations}`);
    
    const contextText = contextItems.length > 0 ? 
      `\n\n## Additional Context\n${contextItems.join('\n\n')}` : '';
    
    return `
# Task: Style Component

## Component Information
${componentName ? `- Name: ${componentName}` : ''}
- Styling System: ${styleSystem}

## Design Specification
${designSpec}
${contextText}

## Component Code
\`\`\`jsx
${componentCode}
\`\`\`

## Instructions
Please style the provided component using the ${styleSystem} approach. 
Follow these guidelines:

1. Create styles that match the design specification
2. Ensure responsive behavior for different screen sizes
3. Follow accessibility best practices (contrast, focus states, etc.)
4. Use a consistent color scheme and typography
5. ${styleSystem === 'tailwind' ? 'Use Tailwind utility classes efficiently' : 
   styleSystem === 'css-modules' ? 'Create modular CSS that avoids conflicts' : 
   styleSystem === 'styled-components' ? 'Use styled-components with proper composition' : 
   'Use appropriate styling techniques for the chosen system'}
6. Apply appropriate spacing and layout
7. Add subtle animations or transitions if appropriate
8. Consider dark mode support if appropriate

## Expected Response Format
Please provide:

1. Updated component code with styling applied
2. Separate style file (if applicable for the chosen styling system)
3. A brief explanation of key design decisions

\`\`\`component
// Updated component code here
\`\`\`

${styleSystem !== 'inline' && styleSystem !== 'tailwind' ? 
`\`\`\`styles
// Styles code here
\`\`\`` : ''}

\`\`\`preview
// A text description of how the component will look, for reference
\`\`\`
`;
  }
  
  /**
   * Parse styling result
   * 
   * @param {string} result - Raw styling result
   * @param {string} styleSystem - Styling system used
   * @returns {Object} Parsed styling result
   */
  parseStyleResult(result, styleSystem) {
    const parsed = {
      component: '',
      styles: '',
      preview: ''
    };
    
    // Extract updated component
    const componentMatch = result.match(/```component\n([\s\S]*?)```/) || 
      result.match(/```(?:jsx|tsx|js|ts)\n([\s\S]*?)```/);
      
    if (componentMatch) {
      parsed.component = componentMatch[1].trim();
    }
    
    // Extract styles if applicable
    if (styleSystem !== 'inline' && styleSystem !== 'tailwind') {
      const stylesMatch = result.match(/```styles\n([\s\S]*?)```/) || 
        result.match(/```(?:css|scss|less)\n([\s\S]*?)```/);
        
      if (stylesMatch) {
        parsed.styles = stylesMatch[1].trim();
      }
    }
    
    // Extract preview
    const previewMatch = result.match(/```preview\n([\s\S]*?)```/);
    
    if (previewMatch) {
      parsed.preview = previewMatch[1].trim();
    }
    
    return parsed;
  }
  
  /**
   * Create style files
   * 
   * @param {Object} result - Parsed styling result
   * @param {string} outputPath - Output directory path
   * @param {string} componentName - Component name
   * @param {string} styleSystem - Styling system used
   */
  async createStyleFiles(result, outputPath, componentName, styleSystem) {
    // Ensure output directory exists
    await fs.mkdir(outputPath, { recursive: true });
    
    // Determine file extensions and paths
    let componentExt = '.jsx';
    let styleExt = '.css';
    
    if (styleSystem === 'css-modules') {
      styleExt = '.module.css';
    } else if (styleSystem === 'scss') {
      styleExt = '.scss';
    } else if (styleSystem === 'less') {
      styleExt = '.less';
    }
    
    // Write component file if provided
    if (result.component && componentName) {
      const componentPath = path.join(outputPath, `${componentName}${componentExt}`);
      await fs.writeFile(componentPath, result.component);
      logger.debug(`Updated component written to: ${componentPath}`);
    }
    
    // Write style file if provided
    if (result.styles && componentName && styleSystem !== 'inline' && styleSystem !== 'tailwind') {
      const stylePath = path.join(outputPath, `${componentName}${styleExt}`);
      await fs.writeFile(stylePath, result.styles);
      logger.debug(`Styles written to: ${stylePath}`);
    }
    
    // Write preview as markdown
    if (result.preview) {
      const previewPath = path.join(outputPath, `${componentName || 'component'}-preview.md`);
      await fs.writeFile(previewPath, `# Component Preview\n\n${result.preview}`);
    }
  }
  
  /**
   * Integrate with API
   * 
   * @param {Object} task - API integration task
   * @returns {Object} Integration result
   */
  async integrateAPI(task) {
    logger.info('Integrating with API');
    
    if (!task.api) {
      throw new Error('Task must include API specification');
    }
    
    const api = task.api;
    const component = task.component;
    const componentName = task.componentName || 
      (typeof component === 'string' && !component.includes('import') ? component : null);
    
    // If component is a string name, try to find it in the repository
    let componentCode = component;
    if (componentName && !component) {
      const componentEntry = this.componentRepository.get(`component-${componentName}`);
      
      if (componentEntry && componentEntry.code) {
        componentCode = componentEntry.code;
      }
    }
    
    const framework = task.framework || this.defaultFramework;
    const stateManagement = task.stateManagement || this.defaultStateManagement;
    const approach = task.approach || 'hooks'; // hooks, context, redux, etc.
    
    // Prepare the prompt for the model
    const prompt = this.prepareAPIIntegrationPrompt(
      api,
      componentCode,
      componentName,
      framework,
      stateManagement,
      approach,
      task
    );
    
    try {
      // Generate API integration code
      const integrationResult = await this.generateText(prompt, {
        temperature: 0.3,
        max_tokens: 4000,
        system_prompt: "You are an expert frontend developer with deep expertise in API integration, state management, and data fetching patterns. You write clean, efficient code that handles edge cases, loading states, errors, and caching appropriately."
      });
      
      // Parse result
      const result = this.parseAPIIntegrationResult(integrationResult);
      
      // Create files if output path provided
      if (task.outputPath) {
        await this.createAPIIntegrationFiles(result, task.outputPath);
      }
      
      // Update component in repository if available
      if (componentName && this.componentRepository.has(`component-${componentName}`)) {
        const component = this.componentRepository.get(`component-${componentName}`);
        
        component.updatedComponent = result.component;
        component.apiIntegration = {
          api,
          approach,
          utilities: result.utilities,
          updatedAt: new Date().toISOString()
        };
        
        this.componentRepository.set(`component-${componentName}`, component);
        
        // Update in knowledge base if enabled
        if (this.config.useKnowledgeBase && this.knowledgeBase) {
          await this.storeKnowledge('frontend-components', `component-${componentName}`, component);
        }
      }
      
      // Store API utilities in knowledge base if enabled
      if (this.config.useKnowledgeBase && this.knowledgeBase && result.utilities.length > 0) {
        for (const utility of result.utilities) {
          const utilName = path.basename(utility.path, path.extname(utility.path));
          
          await this.storeKnowledge('frontend-utilities', `api-util-${utilName}`, {
            name: utilName,
            code: utility.content,
            api: typeof api === 'object' ? JSON.stringify(api) : api,
            purpose: 'API Integration',
            createdAt: new Date().toISOString()
          });
        }
      }
      
      logger.info(`API integration completed successfully`);
      
      return {
        component: result.component,
        utilities: result.utilities,
        explanation: result.explanation
      };
    } catch (error) {
      logger.error(`Error integrating API: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Prepare prompt for API integration
   * 
   * @param {Object|string} api - API specification
   * @param {string} component - Component code
   * @param {string} componentName - Component name
   * @param {string} framework - Framework to use
   * @param {string} stateManagement - State management approach
   * @param {string} approach - Integration approach
   * @param {Object} task - Original task with additional context
   * @returns {string} Prepared prompt
   */
  prepareAPIIntegrationPrompt(api, component, componentName, framework, stateManagement, approach, task) {
    // Format API specification
    const apiSpec = typeof api === 'object' ? JSON.stringify(api, null, 2) : api;
    
    // Additional context from task
    const contextItems = [];
    
    if (task.authentication) contextItems.push(`Authentication: ${JSON.stringify(task.authentication, null, 2)}`);
    if (task.error) contextItems.push(`Error Handling: ${task.error}`);
    if (task.loading) contextItems.push(`Loading States: ${task.loading}`);
    if (task.caching) contextItems.push(`Caching Strategy: ${task.caching}`);
    
    const contextText = contextItems.length > 0 ? 
      `\n\n## Additional Context\n${contextItems.join('\n\n')}` : '';
    
    return `
# Task: Integrate API with Frontend

## API Specification
\`\`\`
${apiSpec}
\`\`\`

## Component Information
${componentName ? `- Name: ${componentName}` : ''}
- Framework: ${framework}
- State Management: ${stateManagement}
- Integration Approach: ${approach}
${component ? '\n## Component Code\n```jsx\n' + component + '\n```' : ''}
${contextText}

## Instructions
Please integrate the specified API with the frontend using the ${approach} approach. 
${component ? 'Update the provided component to work with the API.' : 'Create any necessary utility functions for API integration.'}
Follow these guidelines:

1. Create clean API integration code following ${framework} best practices
2. Use ${stateManagement} for state management
3. Implement proper loading states
4. Handle errors appropriately
5. Consider edge cases (empty responses, network failures, etc.)
6. Add appropriate data transformation if needed
7. Include authentication handling if specified
8. Consider caching if appropriate
9. Follow proper separation of concerns

## Expected Response Format
Please provide:

${component ? '1. Updated component code with API integration\n' : ''}
2. Utility functions for API handling
3. Explanation of the integration approach

${component ? '```component\n// Updated component code here\n```\n\n' : ''}

For each utility file, use this format:
\`\`\`filename: path/to/file.js
// Utility code here
\`\`\`

\`\`\`explanation
// Explanation of the approach and key decisions
\`\`\`
`;
  }
  
  /**
   * Parse API integration result
   * 
   * @param {string} result - Raw integration result
   * @returns {Object} Parsed integration result
   */
  parseAPIIntegrationResult(result) {
    const parsed = {
      component: '',
      utilities: [],
      explanation: ''
    };
    
    // Extract updated component
    const componentMatch = result.match(/```component\n([\s\S]*?)```/) || 
      result.match(/```(?:jsx|tsx|js|ts)\n([\s\S]*?)```/);
      
    if (componentMatch) {
      parsed.component = componentMatch[1].trim();
    }
    
    // Extract utility files
    const fileRegex = /```filename: ([\w\/\.-]+)(?:\n|\r\n)([\s\S]*?)```/g;
    let match;
    
    while ((match = fileRegex.exec(result)) !== null) {
      const filePath = match[1].trim();
      const fileContent = match[2].trim();
      
      parsed.utilities.push({
        path: filePath,
        content: fileContent
      });
    }
    
    // Extract explanation
    const explanationMatch = result.match(/```explanation\n([\s\S]*?)```/);
    
    if (explanationMatch) {
      parsed.explanation = explanationMatch[1].trim();
    } else {
      // Try to find explanation text outside of code blocks
      const lines = result.split('\n');
      const explanationLines = [];
      let inCodeBlock = false;
      
      for (const line of lines) {
        if (line.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        
        if (!inCodeBlock && line.trim() && 
            !line.startsWith('#') && 
            !line.startsWith('Expected Response Format')) {
          explanationLines.push(line);
        }
      }
      
      parsed.explanation = explanationLines.join('\n').trim();
    }
    
    return parsed;
  }
  
  /**
   * Create files for API integration
   * 
   * @param {Object} result - Parsed integration result
   * @param {string} outputPath - Output directory path
   */
  async createAPIIntegrationFiles(result, outputPath) {
    // Ensure output directory exists
    await fs.mkdir(outputPath, { recursive: true });
    
    // Write updated component if available
    if (result.component) {
      const componentPath = path.join(outputPath, 'component.jsx');
      await fs.writeFile(componentPath, result.component);
      logger.debug(`Updated component written to: ${componentPath}`);
    }
    
    // Write utility files
    for (const utility of result.utilities) {
      const utilPath = path.join(outputPath, utility.path);
      const utilDir = path.dirname(utilPath);
      
      // Ensure directory exists
      await fs.mkdir(utilDir, { recursive: true });
      
      // Write file
      await fs.writeFile(utilPath, utility.content);
      logger.debug(`Utility written to: ${utilPath}`);
    }
    
    // Write explanation
    if (result.explanation) {
      const explanationPath = path.join(outputPath, 'integration-explanation.md');
      await fs.writeFile(explanationPath, `# API Integration Explanation\n\n${result.explanation}`);
    }
  }
  
  /**
   * Implement a form
   * 
   * @param {Object} task - Form implementation task
   * @returns {Object} Form implementation
   */
  async implementForm(task) {
    logger.info('Implementing form');
    
    if (!task.fields) {
      throw new Error('Task must include form fields');
    }
    
    const fields = task.fields;
    const formName = task.name || 'Form';
    const validationStrategy = task.validation || 'native'; // native, yup, zod, etc.
    const formLibrary = task.library || 'none'; // none, react-hook-form, formik, etc.
    const submitHandler = task.submitHandler || 'console.log';
    
    // Prepare the prompt for the model
    const prompt = this.prepareFormPrompt(
      fields,
      formName,
      validationStrategy,
      formLibrary,
      submitHandler,
      task
    );
    
    try {
      // Generate form implementation
      const formImplementation = await this.generateText(prompt, {
        temperature: 0.3,
        max_tokens: 4000,
        system_prompt: "You are an expert frontend developer specializing in form implementation, validation, and user experience. You write clean, accessible forms with proper validation, error handling, and submission logic."
      });
      
      // Parse form implementation
      const result = this.parseFormImplementation(formImplementation);
      
      // Create form files if output path provided
      if (task.outputPath) {
        await this.createFormFiles(result, task.outputPath, formName);
      }
      
      // Store in knowledge base if enabled
      if (this.config.useKnowledgeBase && this.knowledgeBase) {
        await this.storeKnowledge('frontend-forms', `form-${this.sanitizeFileName(formName)}`, {
          name: formName,
          form: result.form,
          validation: result.validation,
          styles: result.styles,
          test: result.test,
          fields,
          validationStrategy,
          formLibrary,
          createdAt: new Date().toISOString()
        });
      }
      
      logger.info(`Form ${formName} implemented successfully`);
      
      return {
        name: formName,
        form: result.form,
        validation: result.validation,
        styles: result.styles,
        test: result.test,
        fields
      };
    } catch (error) {
      logger.error(`Error implementing form: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Prepare prompt for form implementation
   * 
   * @param {Array} fields - Form fields
   * @param {string} formName - Form name
   * @param {string} validationStrategy - Validation strategy
   * @param {string} formLibrary - Form library to use
   * @param {string} submitHandler - Submit handler code
   * @param {Object} task - Original task with additional context
   * @returns {string} Prepared prompt
   */
  prepareFormPrompt(fields, formName, validationStrategy, formLibrary, submitHandler, task) {
    // Format fields for display
    const fieldsText = typeof fields === 'object' ? 
      JSON.stringify(fields, null, 2) : fields;
    
    // Additional context from task
    const contextItems = [];
    
    if (task.layout) contextItems.push(`Layout: ${task.layout}`);
    if (task.styling) contextItems.push(`Styling: ${task.styling}`);
    if (task.accessibility) contextItems.push(`Accessibility Requirements: ${task.accessibility}`);
    if (task.successMessage) contextItems.push(`Success Message: ${task.successMessage}`);
    if (task.errorHandling) contextItems.push(`Error Handling: ${task.errorHandling}`);
    
    const contextText = contextItems.length > 0 ? 
      `\n\n## Additional Context\n${contextItems.join('\n\n')}` : '';
    
    return `
# Task: Implement Form

## Form Information
- Name: ${formName}
- Validation Strategy: ${validationStrategy}
- Form Library: ${formLibrary}
- TypeScript: ${task.typescript ? 'Yes' : 'No'}

## Fields
${fieldsText}

## Submit Handler
\`\`\`js
${submitHandler}
\`\`\`
${contextText}

## Instructions
Please implement a ${formLibrary === 'none' ? 'custom' : formLibrary} form with the specified fields.
Follow these guidelines:

1. Create a well-structured, accessible form
2. Implement ${validationStrategy} validation for all fields
3. Include appropriate error messages and validation feedback
4. Handle form submission with the provided submit handler
5. Implement proper form state management
6. Add appropriate styling for form elements
7. Include loading state during submission
8. Add success and error messaging
9. Make the form fully accessible (ARIA attributes, keyboard navigation, etc.)
10. Include a test for the form functionality

## Expected Response Format
Please provide your response in the following format:

\`\`\`form
// Form component code here
\`\`\`

\`\`\`validation
// Validation logic (if in a separate file)
\`\`\`

\`\`\`styles
// Form styles (if in a separate file)
\`\`\`

\`\`\`test
// Form test code
\`\`\`
`;
  }
  
  /**
   * Parse form implementation result
   * 
   * @param {string} result - Raw form implementation
   * @returns {Object} Parsed form implementation
   */
  parseFormImplementation(result) {
    const parsed = {
      form: '',
      validation: '',
      styles: '',
      test: ''
    };
    
    // Extract form code
    const formMatch = result.match(/```form\n([\s\S]*?)```/) || 
      result.match(/```(?:jsx|tsx|js|ts)\n([\s\S]*?)```/);
      
    if (formMatch) {
      parsed.form = formMatch[1].trim();
    }
    
    // Extract validation code
    const validationMatch = result.match(/```validation\n([\s\S]*?)```/);
    
    if (validationMatch) {
      parsed.validation = validationMatch[1].trim();
    }
    
    // Extract styles code
    const stylesMatch = result.match(/```styles\n([\s\S]*?)```/) || 
      result.match(/```(?:css|scss|less)\n([\s\S]*?)```/);
      
    if (stylesMatch) {
      parsed.styles = stylesMatch[1].trim();
    }
    
    // Extract test code
    const testMatch = result.match(/```test\n([\s\S]*?)```/) || 
      result.match(/```(?:test|jest)\n([\s\S]*?)```/);
      
    if (testMatch) {
      parsed.test = testMatch[1].trim();
    }
    
    return parsed;
  }
  
  /**
   * Create files for form implementation
   * 
   * @param {Object} result - Parsed form implementation
   * @param {string} outputPath - Output directory path
   * @param {string} formName - Form name
   */
  async createFormFiles(result, outputPath, formName) {
    // Ensure output directory exists
    await fs.mkdir(outputPath, { recursive: true });
    
    // Format form name to PascalCase
    const formattedName = formName
      .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => index === 0 ? word.toUpperCase() : word.toUpperCase())
      .replace(/\s+/g, '');
    
    // Write form component
    if (result.form) {
      const formPath = path.join(outputPath, `${formattedName}.jsx`);
      await fs.writeFile(formPath, result.form);
      logger.debug(`Form component written to: ${formPath}`);
    }
    
    // Write validation if available
    if (result.validation) {
      const validationPath = path.join(outputPath, `${formattedName}Validation.js`);
      await fs.writeFile(validationPath, result.validation);
      logger.debug(`Validation written to: ${validationPath}`);
    }
    
    // Write styles if available
    if (result.styles) {
      const stylesPath = path.join(outputPath, `${formattedName}.css`);
      await fs.writeFile(stylesPath, result.styles);
      logger.debug(`Styles written to: ${stylesPath}`);
    }
    
    // Write test if available
    if (result.test) {
      const testDir = path.join(outputPath, '__tests__');
      await fs.mkdir(testDir, { recursive: true });
      
      const testPath = path.join(testDir, `${formattedName}.test.jsx`);
      await fs.writeFile(testPath, result.test);
      logger.debug(`Test written to: ${testPath}`);
    }
  }
  
  /**
   * Create a custom React hook
   * 
   * @param {Object} task - Hook creation task
   * @returns {Object} Created hook
   */
  async createHook(task) {
    logger.info('Creating custom React hook');
    
    if (!task.purpose) {
      throw new Error('Task must include hook purpose');
    }
    
    const purpose = task.purpose;
    const hookName = task.name || `use${purpose.replace(/\s+/g, '')}`;
    const params = task.params || [];
    const returnValues = task.returnValues || [];
    
    // Get appropriate template
    const template = this.templates.get('react-hook') || DEFAULT_REACT_HOOK_TEMPLATE;
    
    // Prepare the prompt for the model
    const prompt = this.prepareHookPrompt(
      hookName,
      purpose,
      params,
      returnValues,
      template,
      task
    );
    
    try {
      // Generate hook code
      const hookCode = await this.generateText(prompt, {
        temperature: 0.3,
        max_tokens: 3000,
        system_prompt: "You are an expert React developer specializing in custom hooks, state management, and reusable logic. You write clean, efficient, well-documented hooks that follow React best practices and handle edge cases appropriately."
      });
      
      // Parse result
      const result = this.parseHookResult(hookCode);
      
      // Create hook file if output path provided
      if (task.outputPath) {
        await this.createHookFile(result, task.outputPath, hookName);
      }
      
      // Store in knowledge base if enabled
      if (this.config.useKnowledgeBase && this.knowledgeBase) {
        await this.storeKnowledge('frontend-hooks', `hook-${hookName}`, {
          name: hookName,
          purpose,
          code: result.hook,
          test: result.test,
          example: result.example,
          params,
          returnValues,
          createdAt: new Date().toISOString()
        });
      }
      
      logger.info(`Hook ${hookName} created successfully`);
      
      return {
        name: hookName,
        purpose,
        hook: result.hook,
        test: result.test,
        example: result.example
      };
    } catch (error) {
      logger.error(`Error creating hook: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Prepare prompt for hook creation
   * 
   * @param {string} hookName - Hook name
   * @param {string} purpose - Hook purpose
   * @param {Array} params - Hook parameters
   * @param {Array} returnValues - Hook return values
   * @param {string} template - Hook template
   * @param {Object} task - Original task with additional context
   * @returns {string} Prepared prompt
   */
  prepareHookPrompt(hookName, purpose, params, returnValues, template, task) {
    // Format parameters and return values for display
    const paramsText = params.length > 0 ? 
      JSON.stringify(params, null, 2) : 'No parameters';
    
    const returnValuesText = returnValues.length > 0 ? 
      JSON.stringify(returnValues, null, 2) : 'Return values not specified';
    
    // Additional context from task
    const contextItems = [];
    
    if (task.dependencies) contextItems.push(`Dependencies: ${JSON.stringify(task.dependencies, null, 2)}`);
    if (task.stateManagement) contextItems.push(`State Management: ${task.stateManagement}`);
    if (task.sideEffects) contextItems.push(`Side Effects: ${task.sideEffects}`);
    if (task.cleanup) contextItems.push(`Cleanup Requirements: ${task.cleanup}`);
    if (task.performance) contextItems.push(`Performance Considerations: ${task.performance}`);
    
    const contextText = contextItems.length > 0 ? 
      `\n\n## Additional Context\n${contextItems.join('\n\n')}` : '';
    
    return `
# Task: Create Custom React Hook

## Hook Information
- Name: ${hookName}
- Purpose: ${purpose}
- TypeScript: ${task.typescript ? 'Yes' : 'No'}

## Parameters
${paramsText}

## Return Values
${returnValuesText}
${contextText}

## Instructions
Please create a custom React hook based on the information provided.
Follow these guidelines:

1. Create a well-structured, reusable hook
2. Include JSDoc comments with detailed documentation
3. Add appropriate type definitions (PropTypes or TypeScript)
4. Handle edge cases and errors
5. Implement proper cleanup for any side effects
6. Consider performance optimization (memoization, etc.)
7. Include a unit test for the hook
8. Add a usage example to demonstrate the hook in action

## Template Structure (adapt as needed)
${template}

## Expected Response Format
Please provide your response in the following format:

\`\`\`hook
// Hook code here
\`\`\`

\`\`\`test
// Test code here
\`\`\`

\`\`\`example
// Example usage code here
\`\`\`
`;
  }
  
  /**
   * Parse hook creation result
   * 
   * @param {string} result - Raw hook creation result
   * @returns {Object} Parsed hook result
   */
  parseHookResult(result) {
    const parsed = {
      hook: '',
      test: '',
      example: ''
    };
    
    // Extract hook code
    const hookMatch = result.match(/```hook\n([\s\S]*?)```/) || 
      result.match(/```(?:jsx|tsx|js|ts)\n([\s\S]*?)```/);
      
    if (hookMatch) {
      parsed.hook = hookMatch[1].trim();
    }
    
    // Extract test code
    const testMatch = result.match(/```test\n([\s\S]*?)```/) || 
      result.match(/```(?:test|jest)\n([\s\S]*?)```/);
      
    if (testMatch) {
      parsed.test = testMatch[1].trim();
    }
    
    // Extract example code
    const exampleMatch = result.match(/```example\n([\s\S]*?)```/) || 
      result.match(/```(?:example|usage)\n([\s\S]*?)```/);
      
    if (exampleMatch) {
      parsed.example = exampleMatch[1].trim();
    }
    
    return parsed;
  }
  
  /**
   * Create hook files
   * 
   * @param {Object} result - Parsed hook result
   * @param {string} outputPath - Output directory path
   * @param {string} hookName - Hook name
   */
  async createHookFile(result, outputPath, hookName) {
    // Ensure output directory exists
    await fs.mkdir(outputPath, { recursive: true });
    
    // Ensure hook name starts with 'use'
    const formattedName = hookName.startsWith('use') ? 
      hookName : `use${hookName.charAt(0).toUpperCase() + hookName.slice(1)}`;
    
    // Write hook file
    if (result.hook) {
      const hookPath = path.join(outputPath, `${formattedName}.js`);
      await fs.writeFile(hookPath, result.hook);
      logger.debug(`Hook written to: ${hookPath}`);
    }
    
    // Write test file
    if (result.test) {
      const testDir = path.join(outputPath, '__tests__');
      await fs.mkdir(testDir, { recursive: true });
      
      const testPath = path.join(testDir, `${formattedName}.test.js`);
      await fs.writeFile(testPath, result.test);
      logger.debug(`Test written to: ${testPath}`);
    }
    
    // Write example file
    if (result.example) {
      const examplePath = path.join(outputPath, `${formattedName}.example.js`);
      await fs.writeFile(examplePath, result.example);
      logger.debug(`Example written to: ${examplePath}`);
    }
  }
  
  /**
   * Add tests to a component
   * 
   * @param {Object} task - Test addition task
   * @returns {Object} Created tests
   */
  async addTest(task) {
    logger.info('Adding tests to component');
    
    if (!task.component) {
      throw new Error('Task must include component code or name');
    }
    
    // Get component code
    let componentCode = task.component;
    let componentName = task.name;
    
    // If component is a string name, try to find it in the repository
    if (typeof componentCode === 'string' && !componentCode.includes('import') && !componentCode.includes('function')) {
      componentName = componentCode;
      
      const componentEntry = this.componentRepository.get(`component-${componentName}`);
      
      if (componentEntry && componentEntry.code) {
        componentCode = componentEntry.code;
      } else {
        throw new Error(`Component ${componentName} not found in repository`);
      }
    } else if (!componentName) {
      // Try to extract component name from code
      const nameMatch = componentCode.match(/function\s+(\w+)/) || 
        componentCode.match(/const\s+(\w+)\s*=/);
        
      if (nameMatch) {
        componentName = nameMatch[1];
      } else {
        componentName = 'Component';
      }
    }
    
    const testLibrary = task.testLibrary || 'jest';
    const testingFramework = task.testingFramework || '@testing-library/react';
    
    // Prepare the prompt for the model
    const prompt = this.prepareTestPrompt(
      componentCode,
      componentName,
      testLibrary,
      testingFramework,
      task
    );
    
    try {
      // Generate test code
      const testCode = await this.generateText(prompt, {
        temperature: 0.3,
        max_tokens: 3000,
        system_prompt: "You are an expert in frontend testing with deep knowledge of testing frameworks, best practices, and test-driven development. You write comprehensive, maintainable tests that focus on behavior rather than implementation details."
      });
      
      // Parse result
      const result = this.parseTestResult(testCode);
      
      // Create test file if output path provided
      if (task.outputPath) {
        await this.createTestFile(result, task.outputPath, componentName, testLibrary);
      }
      
      // Update component in repository if available
      if (componentName && this.componentRepository.has(`component-${componentName}`)) {
        const component = this.componentRepository.get(`component-${componentName}`);
        
        component.test = result.test;
        
        this.componentRepository.set(`component-${componentName}`, component);
        
        // Update in knowledge base if enabled
        if (this.config.useKnowledgeBase && this.knowledgeBase) {
          await this.storeKnowledge('frontend-components', `component-${componentName}`, component);
        }
      }
      
      logger.info(`Tests created for ${componentName} successfully`);
      
      return {
        componentName,
        test: result.test,
        testUtils: result.testUtils,
        setupInstructions: result.setupInstructions
      };
    } catch (error) {
      logger.error(`Error creating tests: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Prepare prompt for test creation
   * 
   * @param {string} componentCode - Component code
   * @param {string} componentName - Component name
   * @param {string} testLibrary - Test library to use
   * @param {string} testingFramework - Testing framework to use
   * @param {Object} task - Original task with additional context
   * @returns {string} Prepared prompt
   */
  prepareTestPrompt(componentCode, componentName, testLibrary, testingFramework, task) {
    // Additional context from task
    const contextItems = [];
    
    if (task.testCases) contextItems.push(`Test Cases: ${JSON.stringify(task.testCases, null, 2)}`);
    if (task.mocks) contextItems.push(`Mocks: ${JSON.stringify(task.mocks, null, 2)}`);
    if (task.coverage) contextItems.push(`Coverage Requirements: ${task.coverage}`);
    if (task.dependencies) contextItems.push(`Dependencies: ${JSON.stringify(task.dependencies, null, 2)}`);
    
    const contextText = contextItems.length > 0 ? 
      `\n\n## Additional Context\n${contextItems.join('\n\n')}` : '';
    
    // Get template
    const template = this.templates.get('test-component') || DEFAULT_TEST_COMPONENT_TEMPLATE;
    
    return `
# Task: Create Tests for React Component

## Component Information
- Name: ${componentName}
- Test Library: ${testLibrary}
- Testing Framework: ${testingFramework}
- TypeScript: ${task.typescript ? 'Yes' : 'No'}

## Component Code
\`\`\`jsx
${componentCode}
\`\`\`
${contextText}

## Instructions
Please create comprehensive tests for the provided component.
Follow these guidelines:

1. Focus on testing behavior rather than implementation details
2. Test all key functionality and user interactions
3. Include tests for edge cases and error states
4. Use best practices for ${testLibrary} and ${testingFramework}
5. Mock dependencies appropriately
6. Add meaningful test descriptions
7. Ensure good test coverage
8. Include any necessary test utilities or helpers
9. If needed, provide setup instructions for the test environment

## Template Structure (adapt as needed)
${template}

## Expected Response Format
Please provide your response in the following format:

\`\`\`test
// Test code here
\`\`\`

\`\`\`testUtils
// Any test utilities or helpers (if needed)
\`\`\`

\`\`\`setup
// Setup instructions (if needed)
\`\`\`
`;
  }
  
  /**
   * Parse test creation result
   * 
   * @param {string} result - Raw test creation result
   * @returns {Object} Parsed test result
   */
  parseTestResult(result) {
    const parsed = {
      test: '',
      testUtils: '',
      setupInstructions: ''
    };
    
    // Extract test code
    const testMatch = result.match(/```test\n([\s\S]*?)```/) || 
      result.match(/```(?:jsx|tsx|js|ts|jest|testing-library)\n([\s\S]*?)```/);
      
    if (testMatch) {
      parsed.test = testMatch[1].trim();
    }
    
    // Extract test utilities
    const testUtilsMatch = result.match(/```testUtils\n([\s\S]*?)```/) || 
      result.match(/```(?:utils|helpers)\n([\s\S]*?)```/);
      
    if (testUtilsMatch) {
      parsed.testUtils = testUtilsMatch[1].trim();
    }
    
    // Extract setup instructions
    const setupMatch = result.match(/```setup\n([\s\S]*?)```/) || 
      result.match(/```(?:setup|config)\n([\s\S]*?)```/);
      
    if (setupMatch) {
      parsed.setupInstructions = setupMatch[1].trim();
    }
    
    return parsed;
  }
  
  /**
   * Create test files
   * 
   * @param {Object} result - Parsed test result
   * @param {string} outputPath - Output directory path
   * @param {string} componentName - Component name
   * @param {string} testLibrary - Test library used
   */
  async createTestFile(result, outputPath, componentName, testLibrary) {
    // Ensure output directory exists
    const testDir = path.join(outputPath, '__tests__');
    await fs.mkdir(testDir, { recursive: true });
    
    // Determine file extension
    const fileExt = testLibrary === 'jest' ? 
      (componentName.endsWith('tsx') ? '.tsx' : '.js') : '.js';
    
    // Write test file
    if (result.test) {
      const testPath = path.join(testDir, `${componentName}.test${fileExt}`);
      await fs.writeFile(testPath, result.test);
      logger.debug(`Test written to: ${testPath}`);
    }
    
    // Write test utilities if provided
    if (result.testUtils) {
      const utilsDir = path.join(testDir, 'utils');
      await fs.mkdir(utilsDir, { recursive: true });
      
      const utilsPath = path.join(utilsDir, `test-utils${fileExt}`);
      await fs.writeFile(utilsPath, result.testUtils);
      logger.debug(`Test utilities written to: ${utilsPath}`);
    }
    
    // Write setup instructions if provided
    if (result.setupInstructions) {
      const setupPath = path.join(testDir, 'setup-instructions.md');
      await fs.writeFile(setupPath, `# Test Setup Instructions\n\n${result.setupInstructions}`);
      logger.debug(`Setup instructions written to: ${setupPath}`);
    }
  }
  
  /**
   * Fix an issue in a component
   * 
   * @param {Object} task - Issue fixing task
   * @returns {Object} Fixed component
   */
  async fixIssue(task) {
    logger.info('Fixing issue in component');
    
    if (!task.component) {
      throw new Error('Task must include component code or name');
    }
    
    if (!task.issue) {
      throw new Error('Task must include issue description');
    }
    
    // Get component code
    let componentCode = task.component;
    let componentName = task.name;
    
    // If component is a string name, try to find it in the repository
    if (typeof componentCode === 'string' && !componentCode.includes('import') && !componentCode.includes('function')) {
      componentName = componentCode;
      
      const componentEntry = this.componentRepository.get(`component-${componentName}`);
      
      if (componentEntry && componentEntry.code) {
        componentCode = componentEntry.code;
      } else {
        throw new Error(`Component ${componentName} not found in repository`);
      }
    }
    
    const issue = task.issue;
    
    // Prepare the prompt for the model
    const prompt = this.prepareFixIssuePrompt(
      componentCode,
      componentName,
      issue,
      task
    );
    
    try {
      // Generate fix
      const fixResult = await this.generateText(prompt, {
        temperature: 0.2,
        max_tokens: 3000,
        system_prompt: "You are an expert React developer with deep debugging skills. You excel at identifying and fixing issues in React components while maintaining code quality and following best practices."
      });
      
      // Parse result
      const result = this.parseFixResult(fixResult);
      
      // Create fixed file if output path provided
      if (task.outputPath) {
        await this.createFixedFile(result, task.outputPath, componentName);
      }
      
      // Update component in repository if available
      if (componentName && this.componentRepository.has(`component-${componentName}`)) {
        const component = this.componentRepository.get(`component-${componentName}`);
        
        component.fixedCode = result.fixed;
        component.issueFixed = issue;
        component.fixExplanation = result.explanation;
        
        this.componentRepository.set(`component-${componentName}`, component);
        
        // Update in knowledge base if enabled
        if (this.config.useKnowledgeBase && this.knowledgeBase) {
          await this.storeKnowledge('frontend-components', `component-${componentName}`, component);
        }
      }
      
      logger.info(`Issue fixed in ${componentName} successfully`);
      
      return {
        componentName,
        original: componentCode,
        fixed: result.fixed,
        explanation: result.explanation
      };
    } catch (error) {
      logger.error(`Error fixing issue: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Prepare prompt for fixing an issue
   * 
   * @param {string} componentCode - Component code
   * @param {string} componentName - Component name
   * @param {string} issue - Issue description
   * @param {Object} task - Original task with additional context
   * @returns {string} Prepared prompt
   */
  prepareFixIssuePrompt(componentCode, componentName, issue, task) {
    // Additional context from task
    const contextItems = [];
    
    if (task.errorMessage) contextItems.push(`Error Message: ${task.errorMessage}`);
    if (task.reproSteps) contextItems.push(`Reproduction Steps: ${JSON.stringify(task.reproSteps, null, 2)}`);
    if (task.expectedBehavior) contextItems.push(`Expected Behavior: ${task.expectedBehavior}`);
    if (task.actualBehavior) contextItems.push(`Actual Behavior: ${task.actualBehavior}`);
    
    const contextText = contextItems.length > 0 ? 
      `\n\n## Additional Context\n${contextItems.join('\n\n')}` : '';
    
    return `
# Task: Fix Issue in React Component

## Component Information
- Name: ${componentName}
- Issue: ${issue}

## Component Code
\`\`\`jsx
${componentCode}
\`\`\`
${contextText}

## Instructions
Please fix the described issue in the provided component.
Follow these guidelines:

1. Identify the root cause of the issue
2. Implement a clean, efficient fix
3. Maintain the component's existing structure and style
4. Explain your reasoning and the changes made
5. Ensure the fix follows React best practices
6. Consider edge cases and potential side effects
7. Add comments explaining the fix if appropriate

## Expected Response Format
Please provide your response in the following format:

\`\`\`fixed
// Fixed component code here
\`\`\`

\`\`\`explanation
// Explanation of the issue and fix
\`\`\`
`;
  }
  
  /**
   * Parse fix result
   * 
   * @param {string} result - Raw fix result
   * @returns {Object} Parsed fix result
   */
  parseFixResult(result) {
    const parsed = {
      fixed: '',
      explanation: ''
    };
    
    // Extract fixed code
    const fixedMatch = result.match(/```fixed\n([\s\S]*?)```/) || 
      result.match(/```(?:jsx|tsx|js|ts)\n([\s\S]*?)```/);
      
    if (fixedMatch) {
      parsed.fixed = fixedMatch[1].trim();
    }
    
    // Extract explanation
    const explanationMatch = result.match(/```explanation\n([\s\S]*?)```/);
    
    if (explanationMatch) {
      parsed.explanation = explanationMatch[1].trim();
    } else {
      // Try to find explanation text outside of code blocks
      const lines = result.split('\n');
      const explanationLines = [];
      let inCodeBlock = false;
      
      for (const line of lines) {
        if (line.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        
        if (!inCodeBlock && line.trim() && !line.startsWith('#')) {
          explanationLines.push(line);
        }
      }
      
      parsed.explanation = explanationLines.join('\n').trim();
    }
    
    return parsed;
  }
  
  /**
   * Create fixed component file
   * 
   * @param {Object} result - Parsed fix result
   * @param {string} outputPath - Output directory path
   * @param {string} componentName - Component name
   */
  async createFixedFile(result, outputPath, componentName) {
    // Ensure output directory exists
    await fs.mkdir(outputPath, { recursive: true });
    
    // Write fixed component
    if (result.fixed) {
      const fixedPath = path.join(outputPath, `${componentName}.fixed.jsx`);
      await fs.writeFile(fixedPath, result.fixed);
      logger.debug(`Fixed component written to: ${fixedPath}`);
    }
    
    // Write explanation
    if (result.explanation) {
      const explanationPath = path.join(outputPath, `${componentName}.fix-explanation.md`);
      await fs.writeFile(explanationPath, `# Fix Explanation\n\n${result.explanation}`);
      logger.debug(`Fix explanation written to: ${explanationPath}`);
    }
  }
}

// Default templates
const DEFAULT_REACT_COMPONENT_TEMPLATE = `
import React from 'react';
import PropTypes from 'prop-types';
import './ComponentName.css';

/**
 * Component description
 */
function ComponentName({ prop1, prop2 }) {
  // State and hooks

  // Handlers and effects

  // Rendering
  return (
    <div className="component-name">
      {/* Component content */}
    </div>
  );
}

ComponentName.propTypes = {
  prop1: PropTypes.string.isRequired,
  prop2: PropTypes.number
};

ComponentName.defaultProps = {
  prop2: 0
};

export default ComponentName;
`;

const DEFAULT_REACT_PAGE_TEMPLATE = `
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './PageName.css';

// Import components
import ComponentA from '../components/ComponentA';
import ComponentB from '../components/ComponentB';

/**
 * Page description
 */
function PageName() {
  // State and hooks
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const { id } = useParams();
  const navigate = useNavigate();

  // Data fetching
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch data
        setLoading(false);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };
    
    fetchData();
  }, [id]);

  // Event handlers

  // Loading state
  if (loading) return <div>Loading...</div>;
  
  // Error state
  if (error) return <div>Error: {error}</div>;

  // Rendering
  return (
    <div className="page-name">
      <h1>Page Title</h1>
      
      <section className="main-content">
        <ComponentA />
        <ComponentB />
      </section>
    </div>
  );
}

export default PageName;
`;

const DEFAULT_REACT_HOOK_TEMPLATE = `
import { useState, useEffect, useCallback } from 'react';

/**
 * Hook description
 * 
 * @param {type} param1 - Description of param1
 * @param {type} param2 - Description of param2
 * @returns {object} Description of return values
 */
function useHookName(param1, param2) {
  // State
  const [value1, setValue1] = useState(initialValue);
  const [value2, setValue2] = useState(initialValue);
  
  // Callbacks
  const handleSomething = useCallback(() => {
    // Implementation
  }, [/* dependencies */]);
  
  // Effects
  useEffect(() => {
    // Setup logic
    
    return () => {
      // Cleanup logic
    };
  }, [/* dependencies */]);
  
  // Return values
  return {
    value1,
    value2,
    handleSomething
  };
}

export default useHookName;
`;

const DEFAULT_CSS_MODULE_TEMPLATE = `
.container {
  display: flex;
  flex-direction: column;
  padding: 1rem;
}

.header {
  font-size: 1.5rem;
  font-weight: bold;
  margin-bottom: 1rem;
}

.content {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

/* Responsive styles */
@media (max-width: 768px) {
  .content {
    flex-direction: column;
  }
}
`;

const DEFAULT_TEST_COMPONENT_TEMPLATE = `
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ComponentName from '../ComponentName';

describe('ComponentName', () => {
  test('renders correctly', () => {
    render(<ComponentName />);
    // Assertions
  });
  
  test('handles user interaction', () => {
    render(<ComponentName />);
    // Trigger events
    // Assertions
  });
  
  test('handles edge cases', () => {
    // Edge case testing
  });
});
`;

module.exports = FrontendAgent;
