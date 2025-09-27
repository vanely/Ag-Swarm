const logger = require('../../utils/logger');
const SharedState = require('../communication/shared-state');
const KnowledgeBase = require('../memory/knowledge-base');

/**
 * TaskRouter class responsible for routing tasks to the most appropriate agents
 * based on agent capabilities, current load, and task requirements
 */
class TaskRouter {
  constructor() {
    this.sharedState = new SharedState();
    this.knowledgeBase = new KnowledgeBase();
    
    // Task routing rules and priorities
    this.routingRules = {
      // Default agent mappings for task types
      defaultAgentMapping: {
        'planning': 'planning-agent',
        'architecture': 'planning-agent',
        'frontend_development': 'frontend-agent',
        'ui_design': 'frontend-agent',
        'backend_development': 'backend-agent',
        'api_design': 'backend-agent',
        'database': 'backend-agent',
        'infrastructure': 'devops-agent',
        'deployment': 'devops-agent',
        'security_audit': 'security-agent',
        'testing': 'qa-agent',
        'coordination': 'coordination-agent',
        'data_engineering': 'data-engineering-agent',
        'mobile_development': 'mobile-agent',
        'performance_optimization': 'performance-agent'
      },
      
      // Priority rules for task assignment
      priorityRules: [
        { factor: 'task_criticality', weight: 0.4 },
        { factor: 'agent_expertise', weight: 0.3 },
        { factor: 'agent_load', weight: 0.2 },
        { factor: 'dependency_proximity', weight: 0.1 }
      ]
    };
  }

  /**
   * Initialize the task router with custom routing rules if provided
   * @param {Object} customRules - Custom routing rules to override defaults
   */
  async initialize(customRules = null) {
    try {
      // Load any existing routing rules from the knowledge base
      const existingRules = await this.knowledgeBase.retrieveKnowledge('orchestration.routing_rules');
      
      if (existingRules) {
        this.routingRules = {
          ...this.routingRules,
          ...existingRules
        };
        logger.info('TaskRouter initialized with existing routing rules from knowledge base');
      }
      
      // Apply any custom rules passed during initialization
      if (customRules) {
        this.routingRules = {
          ...this.routingRules,
          ...customRules
        };
        
        // Store updated rules in the knowledge base
        await this.knowledgeBase.storeKnowledge('orchestration.routing_rules', this.routingRules);
        logger.info('TaskRouter initialized with custom routing rules');
      }
    } catch (error) {
      logger.error(`Error initializing TaskRouter: ${error.message}`);
      throw error;
    }
  }

  /**
   * Route a task to the most appropriate agent
   * @param {Object} task - The task to route
   * @param {Object} agentRegistry - Registry of available agents
   * @returns {String} The name of the agent to assign the task to
   */
  async routeTask(task, agentRegistry) {
    try {
      logger.info(`Routing task: ${task.id} of type ${task.type}`);
      
      // Get candidate agents based on task type
      const candidateAgents = await this.getCandidateAgents(task, agentRegistry);
      
      if (candidateAgents.length === 0) {
        throw new Error(`No candidate agents available for task type: ${task.type}`);
      }
      
      // For tasks with explicit agent assignment, use that assignment
      if (task.assignTo && agentRegistry[task.assignTo]) {
        return task.assignTo;
      }
      
      // Score each candidate agent
      const scoredAgents = await this.scoreAgents(task, candidateAgents, agentRegistry);
      
      // Sort agents by score (highest first)
      scoredAgents.sort((a, b) => b.score - a.score);
      
      // Return the highest scoring agent
      return scoredAgents[0].name;
    } catch (error) {
      logger.error(`Error routing task ${task.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get candidate agents for a task based on its type and requirements
   * @param {Object} task - The task to find candidates for
   * @param {Object} agentRegistry - Registry of available agents
   * @returns {Array} List of candidate agent names
   */
  async getCandidateAgents(task, agentRegistry) {
    // Start with the default mapping based on task type
    let candidateAgents = [];
    
    // Add default agent for this task type if available
    const defaultAgent = this.routingRules.defaultAgentMapping[task.type];
    if (defaultAgent && agentRegistry[defaultAgent]) {
      candidateAgents.push(defaultAgent);
    }
    
    // Add agents that have explicitly registered capability for this task type
    for (const [agentName, agentInfo] of Object.entries(agentRegistry)) {
      if (agentInfo.capabilities && 
          agentInfo.capabilities.includes(task.type) && 
          !candidateAgents.includes(agentName)) {
        candidateAgents.push(agentName);
      }
    }
    
    // If no candidates yet, add agents from the agent's category
    if (candidateAgents.length === 0) {
      const taskCategory = task.type.split('_')[0]; // e.g., 'frontend' from 'frontend_component'
      
      for (const [taskType, agentName] of Object.entries(this.routingRules.defaultAgentMapping)) {
        if (taskType.startsWith(taskCategory) && 
            agentRegistry[agentName] && 
            !candidateAgents.includes(agentName)) {
          candidateAgents.push(agentName);
        }
      }
    }
    
    // If still no candidates, add any agent with a 'generic' capability
    if (candidateAgents.length === 0) {
      for (const [agentName, agentInfo] of Object.entries(agentRegistry)) {
        if (agentInfo.capabilities && 
            agentInfo.capabilities.includes('generic') && 
            !candidateAgents.includes(agentName)) {
          candidateAgents.push(agentName);
        }
      }
    }
    
    // Filter out inactive agents
    return candidateAgents.filter(agentName => {
      const agent = agentRegistry[agentName];
      return agent && agent.status === 'active';
    });
  }

  /**
   * Score agents based on various factors to determine the best agent for a task
   * @param {Object} task - The task to assign
   * @param {Array} candidateAgents - List of candidate agent names
   * @param {Object} agentRegistry - Registry of available agents
   * @returns {Array} List of agents with scores
   */
  async scoreAgents(task, candidateAgents, agentRegistry) {
    const scoredAgents = [];
    
    // Get current agent workloads
    const agentWorkloads = await this.sharedState.get('system.agent_workloads') || {};
    
    // Get task dependencies
    const taskDependencies = task.dependencies || [];
    
    // Score each candidate agent
    for (const agentName of candidateAgents) {
      const agent = agentRegistry[agentName];
      
      // Skip if agent not found or not active
      if (!agent || agent.status !== 'active') {
        continue;
      }
      
      // Calculate base scores for each factor
      const expertiseScore = this.calculateExpertiseScore(task, agent);
      const loadScore = this.calculateLoadScore(agentName, agentWorkloads);
      const dependencyScore = this.calculateDependencyScore(task, agentName, agentRegistry);
      const criticalityScore = this.calculateCriticalityScore(task, agent);
      
      // Apply weights from priority rules
      const weightedScore = 
        (expertiseScore * this.getFactorWeight('agent_expertise')) +
        (loadScore * this.getFactorWeight('agent_load')) +
        (dependencyScore * this.getFactorWeight('dependency_proximity')) +
        (criticalityScore * this.getFactorWeight('task_criticality'));
      
      // Add to scored agents
      scoredAgents.push({
        name: agentName,
        score: weightedScore,
        expertiseScore,
        loadScore,
        dependencyScore,
        criticalityScore
      });
    }
    
    return scoredAgents;
  }

  /**
   * Calculate expertise score - how well the agent's expertise matches the task
   * @param {Object} task - The task to assign
   * @param {Object} agent - The agent to score
   * @returns {Number} Expertise score (0-1)
   */
  calculateExpertiseScore(task, agent) {
    // Base score if agent's primary role matches task type
    let score = 0;
    
    // Check if the agent's name or description contains the task type
    const taskType = task.type.toLowerCase();
    const agentName = agent.agentName.toLowerCase();
    const agentDescription = (agent.agentDescription || '').toLowerCase();
    
    if (agentName.includes(taskType) || taskType.includes(agentName.replace('-agent', ''))) {
      score += 0.7;
    }
    
    if (agentDescription.includes(taskType)) {
      score += 0.2;
    }
    
    // Check specific capabilities if available
    if (agent.capabilities) {
      if (agent.capabilities.includes(task.type)) {
        score += 0.3;
      }
      
      // Check if agent has all required skills for the task
      if (task.requiredSkills) {
        const matchingSkills = task.requiredSkills.filter(skill => 
          agent.capabilities.includes(skill)
        ).length;
        
        // Add score based on percentage of matching skills
        if (task.requiredSkills.length > 0) {
          score += 0.3 * (matchingSkills / task.requiredSkills.length);
        }
      }
    }
    
    // Cap score at 1
    return Math.min(score, 1);
  }

  /**
   * Calculate load score - how available the agent is to take on new tasks
   * @param {String} agentName - The name of the agent
   * @param {Object} agentWorkloads - Current workloads of all agents
   * @returns {Number} Load score (0-1)
   */
  calculateLoadScore(agentName, agentWorkloads) {
    const maxTasks = 5; // Assume agents can handle up to 5 tasks simultaneously
    const currentTasks = agentWorkloads[agentName] || 0;
    
    // Higher score for agents with fewer tasks
    return Math.max(0, 1 - (currentTasks / maxTasks));
  }

  /**
   * Calculate dependency score - whether agent has worked on dependent tasks
   * @param {Object} task - The task to assign
   * @param {String} agentName - The name of the agent
   * @param {Object} agentRegistry - Registry of available agents
   * @returns {Number} Dependency score (0-1)
   */
  calculateDependencyScore(task, agentName, agentRegistry) {
    // If task has no dependencies, give neutral score
    if (!task.dependencies || task.dependencies.length === 0) {
      return 0.5;
    }
    
    let dependencyScore = 0;
    let totalDependencies = task.dependencies.length;
    
    // Check if agent has worked on dependent tasks
    for (const dependencyId of task.dependencies) {
      const agent = agentRegistry[agentName];
      
      if (agent.completedTasks && agent.completedTasks.includes(dependencyId)) {
        dependencyScore += 1;
      }
    }
    
    // Calculate average score across all dependencies
    return dependencyScore / totalDependencies;
  }

  /**
   * Calculate criticality score - whether the agent is suited for critical tasks
   * @param {Object} task - The task to assign
   * @param {Object} agent - The agent to score
   * @returns {Number} Criticality score (0-1)
   */
  calculateCriticalityScore(task, agent) {
    const taskPriority = task.priority || 'medium';
    const priorityValues = {
      'low': 0.3,
      'medium': 0.5,
      'high': 0.7,
      'critical': 1.0
    };
    
    const priorityValue = priorityValues[taskPriority] || 0.5;
    
    // Agents with higher reliability ratings get preference for critical tasks
    const agentReliability = agent.reliability || 0.5;
    
    // For high priority tasks, prioritize reliable agents
    if (priorityValue >= 0.7) {
      return agentReliability;
    } 
    // For lower priority tasks, give slightly higher scores to less-reliable agents
    // to balance workload (as long as they meet a minimum threshold)
    else if (agentReliability >= 0.4) {
      return 1 - (0.5 * agentReliability);
    } else {
      return 0.3; // Low score for unreliable agents
    }
  }

  /**
   * Get the weight for a specific routing factor
   * @param {String} factorName - The name of the factor
   * @returns {Number} The weight (0-1)
   */
  getFactorWeight(factorName) {
    const rule = this.routingRules.priorityRules.find(r => r.factor === factorName);
    return rule ? rule.weight : 0;
  }

  /**
   * Update agent workload after task assignment
   * @param {String} agentName - The name of the agent
   * @param {Number} change - The change in workload (positive for increase, negative for decrease)
   */
  async updateAgentWorkload(agentName, change = 1) {
    try {
      // Get current workloads
      const agentWorkloads = await this.sharedState.get('system.agent_workloads') || {};
      
      // Update workload for the specified agent
      agentWorkloads[agentName] = (agentWorkloads[agentName] || 0) + change;
      
      // Ensure workload doesn't go below 0
      if (agentWorkloads[agentName] < 0) {
        agentWorkloads[agentName] = 0;
      }
      
      // Save updated workloads
      await this.sharedState.set('system.agent_workloads', agentWorkloads);
      
      logger.debug(`Updated workload for ${agentName}: ${agentWorkloads[agentName]}`);
    } catch (error) {
      logger.error(`Error updating agent workload: ${error.message}`);
    }
  }

  /**
   * Update routing rules based on performance feedback
   * @param {Object} feedback - Feedback about routing performance
   */
  async updateRoutingRules(feedback) {
    try {
      // Update weights based on feedback
      if (feedback.factorWeights) {
        for (const [factor, weight] of Object.entries(feedback.factorWeights)) {
          const ruleIndex = this.routingRules.priorityRules.findIndex(r => r.factor === factor);
          
          if (ruleIndex >= 0) {
            this.routingRules.priorityRules[ruleIndex].weight = weight;
          } else {
            this.routingRules.priorityRules.push({
              factor,
              weight
            });
          }
        }
        
        // Normalize weights
        const totalWeight = this.routingRules.priorityRules.reduce((sum, rule) => sum + rule.weight, 0);
        
        if (totalWeight > 0) {
          this.routingRules.priorityRules.forEach(rule => {
            rule.weight = rule.weight / totalWeight;
          });
        }
      }
      
      // Update agent mappings
      if (feedback.agentMappings) {
        this.routingRules.defaultAgentMapping = {
          ...this.routingRules.defaultAgentMapping,
          ...feedback.agentMappings
        };
      }
      
      // Store updated rules in the knowledge base
      await this.knowledgeBase.storeKnowledge('orchestration.routing_rules', this.routingRules);
      
      logger.info('Updated task routing rules based on feedback');
    } catch (error) {
      logger.error(`Error updating routing rules: ${error.message}`);
      throw error;
    }
  }
}

module.exports = TaskRouter;
