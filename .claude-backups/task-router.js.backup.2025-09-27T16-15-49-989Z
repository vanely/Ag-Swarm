/**
 * Task Router for the Agentic Software Development Swarm
 * 
 * This module handles routing tasks to the appropriate agents based on specialization.
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class TaskRouter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.agentRegistry = new Map();
    this.specializationMap = new Map();
    this.defaultAgent = null;
    
    // Initialize with config
    this.assignmentStrategy = config.assignmentStrategy || 'specialization';
    this.loadBalancing = config.loadBalancing !== false;
    this.prioritization = config.prioritization !== false;
    
    logger.info('Task Router initialized');
    logger.debug(`Task Router configuration: ${JSON.stringify(config)}`);
  }
  
  /**
   * Register an agent with the task router
   * 
   * @param {string} agentId - Unique identifier for the agent
   * @param {Object} agent - The agent instance
   * @param {Array<string>} specializations - List of task types this agent can handle
   * @param {Object} capabilities - Additional capabilities of the agent
   */
  registerAgent(agentId, agent, specializations = [], capabilities = {}) {
    if (this.agentRegistry.has(agentId)) {
      logger.warn(`Agent ${agentId} is already registered`);
      return false;
    }
    
    // Register the agent
    this.agentRegistry.set(agentId, {
      agent,
      specializations,
      capabilities,
      status: 'idle',
      activeTaskCount: 0,
      maxConcurrentTasks: capabilities.maxConcurrentTasks || 3,
      taskHistory: [],
    });
    
    // Map specializations to agents
    for (const spec of specializations) {
      if (!this.specializationMap.has(spec)) {
        this.specializationMap.set(spec, []);
      }
      
      this.specializationMap.get(spec).push(agentId);
    }
    
    // Set as default agent if first one or explicitly marked as default
    if (!this.defaultAgent || capabilities.isDefault) {
      this.defaultAgent = agentId;
    }
    
    logger.info(`Agent ${agentId} registered with specializations: ${specializations.join(', ')}`);
    this.emit('agent:registered', { agentId, specializations });
    
    return true;
  }
  
  /**
   * Unregister an agent from the task router
   * 
   * @param {string} agentId - ID of the agent to unregister
   */
  unregisterAgent(agentId) {
    const agentInfo = this.agentRegistry.get(agentId);
    
    if (!agentInfo) {
      logger.warn(`Cannot unregister agent ${agentId}: not found`);
      return false;
    }
    
    // Remove agent from specialization mappings
    for (const spec of agentInfo.specializations) {
      const agents = this.specializationMap.get(spec);
      
      if (agents) {
        const index = agents.indexOf(agentId);
        
        if (index !== -1) {
          agents.splice(index, 1);
        }
        
        if (agents.length === 0) {
          this.specializationMap.delete(spec);
        }
      }
    }
    
    // Remove from registry
    this.agentRegistry.delete(agentId);
    
    // Update default agent if necessary
    if (this.defaultAgent === agentId) {
      this.defaultAgent = this.agentRegistry.size > 0 ? 
        Array.from(this.agentRegistry.keys())[0] : null;
    }
    
    logger.info(`Agent ${agentId} unregistered`);
    this.emit('agent:unregistered', { agentId });
    
    return true;
  }
  
  /**
   * Update the status of an agent
   * 
   * @param {string} agentId - ID of the agent to update
   * @param {string} status - New status ('idle', 'busy', 'offline')
   */
  updateAgentStatus(agentId, status) {
    const agentInfo = this.agentRegistry.get(agentId);
    
    if (!agentInfo) {
      logger.warn(`Cannot update agent ${agentId} status: not found`);
      return false;
    }
    
    const previousStatus = agentInfo.status;
    agentInfo.status = status;
    
    logger.debug(`Agent ${agentId} status updated from ${previousStatus} to ${status}`);
    this.emit('agent:status-changed', { 
      agentId, 
      previousStatus,
      currentStatus: status 
    });
    
    return true;
  }
  
  /**
   * Finds the best agent to handle a specific task
   * 
   * @param {Object} task - Task to be assigned
   * @returns {string|null} ID of the selected agent, or null if no suitable agent found
   */
  findBestAgentForTask(task) {
    // Extract task type/specialization
    const taskType = task.type || 'default';
    
    // Get agents that can handle this task type
    const specializedAgents = this.specializationMap.get(taskType) || [];
    
    if (specializedAgents.length === 0) {
      logger.warn(`No specialized agents found for task type: ${taskType}`);
      return this.defaultAgent;
    }
    
    // Filter available agents (not offline)
    const availableAgents = specializedAgents
      .map(agentId => {
        const info = this.agentRegistry.get(agentId);
        return { agentId, info };
      })
      .filter(({ info }) => info.status !== 'offline');
    
    if (availableAgents.length === 0) {
      logger.warn(`No available agents found for task type: ${taskType}`);
      return null;
    }
    
    // Apply the selected assignment strategy
    switch (this.assignmentStrategy) {
      case 'specialization':
        return this.assignBySpecialization(task, availableAgents);
        
      case 'load-balanced':
        return this.assignByLoadBalancing(task, availableAgents);
        
      case 'priority':
        return this.assignByPriority(task, availableAgents);
        
      case 'learning-curve':
        return this.assignByLearningCurve(task, availableAgents);
        
      default:
        logger.warn(`Unknown assignment strategy: ${this.assignmentStrategy}, using specialization`);
        return this.assignBySpecialization(task, availableAgents);
    }
  }
  
  /**
   * Assigns a task based on agent specialization
   * 
   * @param {Object} task - The task to assign
   * @param {Array} availableAgents - List of available agents with their info
   * @returns {string} ID of the selected agent
   */
  assignBySpecialization(task, availableAgents) {
    // First, check for idle specialized agents
    const idleSpecialists = availableAgents
      .filter(({ info }) => info.status === 'idle');
    
    if (idleSpecialists.length > 0) {
      // Find the most specialized agent (by capabilities match)
      return this.findMostSpecializedAgent(task, idleSpecialists);
    }
    
    // No idle agents, find the least busy one
    if (this.loadBalancing) {
      return this.findLeastBusyAgent(availableAgents);
    }
    
    // Just pick the first available agent
    return availableAgents[0].agentId;
  }
  
  /**
   * Assigns a task based on agent load balancing
   * 
   * @param {Object} task - The task to assign
   * @param {Array} availableAgents - List of available agents with their info
   * @returns {string} ID of the selected agent
   */
  assignByLoadBalancing(task, availableAgents) {
    return this.findLeastBusyAgent(availableAgents);
  }
  
  /**
   * Assigns a task based on priority
   * 
   * @param {Object} task - The task to assign
   * @param {Array} availableAgents - List of available agents with their info
   * @returns {string} ID of the selected agent
   */
  assignByPriority(task, availableAgents) {
    // Sort agents by priority (assuming higher priority is better)
    const prioritizedAgents = [...availableAgents]
      .sort((a, b) => 
        (b.info.capabilities.priority || 0) - (a.info.capabilities.priority || 0)
      );
    
    // Task priority might override agent selection
    const taskPriority = task.priority || 'normal';
    
    if (taskPriority === 'high') {
      // For high priority tasks, pick the highest priority agent regardless of load
      return prioritizedAgents[0].agentId;
    }
    
    // For normal/low priority, balance between priority and load
    const topAgents = prioritizedAgents.slice(0, Math.ceil(prioritizedAgents.length / 3));
    return this.findLeastBusyAgent(topAgents);
  }
  
  /**
   * Assigns a task based on learning curve (agent's experience with similar tasks)
   * 
   * @param {Object} task - The task to assign
   * @param {Array} availableAgents - List of available agents with their info
   * @returns {string} ID of the selected agent
   */
  assignByLearningCurve(task, availableAgents) {
    const taskType = task.type || 'default';
    
    // Map agents to their experience score for this task type
    const agentsWithExperience = availableAgents.map(({ agentId, info }) => {
      // Count how many similar tasks this agent has handled
      const relevantTaskCount = info.taskHistory.filter(t => t.type === taskType).length;
      
      // Calculate success rate for this task type
      const relevantTasks = info.taskHistory.filter(t => t.type === taskType);
      const successfulTasks = relevantTasks.filter(t => t.success).length;
      const successRate = relevantTasks.length > 0 ? successfulTasks / relevantTasks.length : 0;
      
      // Calculate experience score (combination of relevant task count and success rate)
      const experienceScore = (relevantTaskCount * 0.7) + (successRate * 0.3);
      
      return { agentId, info, experienceScore };
    });
    
    // Sort by experience score (higher is better)
    agentsWithExperience.sort((a, b) => b.experienceScore - a.experienceScore);
    
    // Take the top 3 (or fewer if not available)
    const topAgents = agentsWithExperience.slice(0, Math.min(3, agentsWithExperience.length));
    
    // From top agents, pick the least busy one
    return this.findLeastBusyAgent(topAgents);
  }
  
  /**
   * Finds the most specialized agent for a task
   * 
   * @param {Object} task - The task to assign
   * @param {Array} agents - List of agents to consider
   * @returns {string} ID of the most specialized agent
   */
  findMostSpecializedAgent(task, agents) {
    // Calculate a specialization score for each agent based on capability matching
    const taskRequirements = task.requirements || {};
    
    const agentsWithScore = agents.map(({ agentId, info }) => {
      let score = 0;
      
      // Match task requirements against agent capabilities
      for (const [req, value] of Object.entries(taskRequirements)) {
        if (info.capabilities[req] === value) {
          score += 1;
        }
      }
      
      // Bonus for agents specialized in this exact task type
      if (info.specializations.includes(task.type)) {
        score += 3;
      }
      
      return { agentId, score };
    });
    
    // Sort by score (higher is better)
    agentsWithScore.sort((a, b) => b.score - a.score);
    
    return agentsWithScore[0].agentId;
  }
  
  /**
   * Finds the least busy agent from a list
   * 
   * @param {Array} agents - List of agents to consider
   * @returns {string} ID of the least busy agent
   */
  findLeastBusyAgent(agents) {
    // Sort by active task count (lower is better)
    const sortedAgents = [...agents].sort((a, b) => {
      // Calculate load ratio (active tasks / max concurrent tasks)
      const loadA = a.info.activeTaskCount / a.info.maxConcurrentTasks;
      const loadB = b.info.activeTaskCount / b.info.maxConcurrentTasks;
      
      return loadA - loadB;
    });
    
    return sortedAgents[0].agentId;
  }
  
  /**
   * Routes a task to an appropriate agent and executes it
   * 
   * @param {Object} task - The task to route and execute
   * @returns {Promise<any>} The result of the task execution
   */
  async routeTask(task) {
    // Validate task
    if (!task || typeof task !== 'object') {
      throw new Error('Invalid task: must be an object');
    }
    
    if (!task.id) {
      task.id = `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    }
    
    logger.info(`Routing task ${task.id} of type ${task.type || 'default'}`);
    
    // Find the best agent
    const assignedAgentId = this.findBestAgentForTask(task);
    
    if (!assignedAgentId) {
      throw new Error(`No suitable agent found for task ${task.id} of type ${task.type || 'default'}`);
    }
    
    // Get the agent
    const agentInfo = this.agentRegistry.get(assignedAgentId);
    
    if (!agentInfo) {
      throw new Error(`Agent ${assignedAgentId} not found in registry`);
    }
    
    // Update agent status
    const wasIdle = agentInfo.status === 'idle';
    agentInfo.activeTaskCount++;
    
    if (agentInfo.activeTaskCount >= agentInfo.maxConcurrentTasks) {
      agentInfo.status = 'busy';
    } else if (wasIdle) {
      agentInfo.status = 'active';
    }
    
    this.emit('task:assigned', { 
      taskId: task.id,
      agentId: assignedAgentId,
      taskType: task.type || 'default'
    });
    
    logger.info(`Task ${task.id} assigned to agent ${assignedAgentId}`);
    
    try {
      // Execute the task
      const startTime = Date.now();
      const result = await agentInfo.agent.executeTask(task);
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      
      // Update agent info
      agentInfo.activeTaskCount--;
      agentInfo.taskHistory.push({
        taskId: task.id,
        type: task.type || 'default',
        startTime,
        endTime,
        executionTime,
        success: true
      });
      
      // Update agent status
      if (agentInfo.activeTaskCount === 0) {
        agentInfo.status = 'idle';
      }
      
      this.emit('task:completed', { 
        taskId: task.id,
        agentId: assignedAgentId,
        executionTime
      });
      
      logger.info(`Task ${task.id} completed by agent ${assignedAgentId} in ${executionTime}ms`);
      
      return result;
    } catch (error) {
      // Update agent info
      agentInfo.activeTaskCount--;
      agentInfo.taskHistory.push({
        taskId: task.id,
        type: task.type || 'default',
        startTime: Date.now(),
        endTime: Date.now(),
        executionTime: 0,
        success: false,
        error: error.message
      });
      
      // Update agent status
      if (agentInfo.activeTaskCount === 0) {
        agentInfo.status = 'idle';
      }
      
      this.emit('task:failed', { 
        taskId: task.id,
        agentId: assignedAgentId,
        error
      });
      
      logger.error(`Task ${task.id} failed execution by agent ${assignedAgentId}: ${error.message}`);
      
      throw error;
    }
  }
  
  /**
   * Gets a list of all registered agents and their statuses
   * 
   * @returns {Array} Array of agent information
   */
  getAgentStatuses() {
    return Array.from(this.agentRegistry.entries()).map(([agentId, info]) => ({
      agentId,
      status: info.status,
      specializations: info.specializations,
      activeTaskCount: info.activeTaskCount,
      maxConcurrentTasks: info.maxConcurrentTasks
    }));
  }
  
  /**
   * Gets detailed information about a specific agent
   * 
   * @param {string} agentId - ID of the agent
   * @returns {Object|null} Agent information or null if not found
   */
  getAgentDetails(agentId) {
    const agentInfo = this.agentRegistry.get(agentId);
    
    if (!agentInfo) {
      return null;
    }
    
    return {
      agentId,
      status: agentInfo.status,
      specializations: agentInfo.specializations,
      capabilities: agentInfo.capabilities,
      activeTaskCount: agentInfo.activeTaskCount,
      maxConcurrentTasks: agentInfo.maxConcurrentTasks,
      taskHistory: agentInfo.taskHistory.slice(-10) // Return last 10 tasks
    };
  }
}

module.exports = TaskRouter;
