const logger = require('../../utils/logger');
const MessageQueue = require('../communication/message-queue');
const SharedState = require('../communication/shared-state');
const KnowledgeBase = require('../memory/knowledge-base');
const TaskRouter = require('./task-router');
const StateManager = require('./state-manager');

/**
 * Workflow class responsible for defining and executing the software development
 * process workflow, managing task dependencies, and orchestrating phase transitions
 */
class Workflow {
  constructor() {
    this.messageQueue = new MessageQueue();
    this.sharedState = new SharedState();
    this.knowledgeBase = new KnowledgeBase();
    this.taskRouter = new TaskRouter();
    this.stateManager = new StateManager();
    
    // Define phase configurations
    this.phaseConfigurations = {
      planning: {
        description: 'Requirements gathering and architecture design',
        requiredAgents: ['planning-agent', 'security-agent', 'devops-agent'],
        outputArtifacts: ['requirements', 'architecture_design', 'security_plan'],
        taskTemplates: [
          {
            type: 'requirements_gathering',
            description: 'Gather and analyze project requirements',
            assignTo: 'planning-agent',
            priority: 'high'
          },
          {
            type: 'architecture_design',
            description: 'Design the overall system architecture',
            dependsOn: ['requirements_gathering'],
            assignTo: 'planning-agent',
            priority: 'high'
          },
          {
            type: 'security_requirements',
            description: 'Define security requirements and constraints',
            assignTo: 'security-agent',
            priority: 'high'
          },
          {
            type: 'infrastructure_planning',
            description: 'Plan the infrastructure and deployment strategy',
            dependsOn: ['architecture_design'],
            assignTo: 'devops-agent',
            priority: 'medium'
          }
        ]
      },
      development: {
        description: 'Implementation of frontend, backend, and infrastructure',
        requiredAgents: ['frontend-agent', 'backend-agent', 'devops-agent'],
        outputArtifacts: ['frontend_code', 'backend_code', 'infrastructure_code'],
        taskTemplates: [
          {
            type: 'backend_design',
            description: 'Design backend architecture and API',
            assignTo: 'backend-agent',
            priority: 'high'
          },
          {
            type: 'frontend_design',
            description: 'Design frontend architecture and UI',
            assignTo: 'frontend-agent',
            priority: 'high'
          },
          {
            type: 'infrastructure_setup',
            description: 'Setup infrastructure as code',
            assignTo: 'devops-agent',
            priority: 'medium',
            dependsOn: ['backend_design', 'frontend_design']
          },
          {
            type: 'backend_implementation',
            description: 'Implement backend services and APIs',
            assignTo: 'backend-agent',
            priority: 'high',
            dependsOn: ['backend_design']
          },
          {
            type: 'frontend_implementation',
            description: 'Implement frontend components and pages',
            assignTo: 'frontend-agent',
            priority: 'high',
            dependsOn: ['frontend_design']
          }
        ]
      },
      integration: {
        description: 'Integration testing and quality assurance',
        requiredAgents: ['qa-agent', 'frontend-agent', 'backend-agent'],
        outputArtifacts: ['test_reports', 'integration_report'],
        taskTemplates: [
          {
            type: 'unit_testing',
            description: 'Implement and run unit tests for all components',
            assignTo: 'qa-agent',
            priority: 'high'
          },
          {
            type: 'integration_testing',
            description: 'Implement and run integration tests',
            assignTo: 'qa-agent',
            priority: 'high',
            dependsOn: ['unit_testing']
          },
          {
            type: 'security_testing',
            description: 'Run security tests and audits',
            assignTo: 'security-agent',
            priority: 'high'
          },
          {
            type: 'bug_fixing',
            description: 'Fix issues found during testing',
            assignTo: 'coordination-agent', // Will be delegated
            priority: 'high',
            dependsOn: ['unit_testing', 'integration_testing', 'security_testing']
          }
        ]
      },
      deployment: {
        description: 'Deployment to production and post-deployment verification',
        requiredAgents: ['devops-agent', 'qa-agent', 'security-agent'],
        outputArtifacts: ['deployment_report', 'verification_report'],
        taskTemplates: [
          {
            type: 'deployment_preparation',
            description: 'Prepare deployment scripts and configurations',
            assignTo: 'devops-agent',
            priority: 'high'
          },
          {
            type: 'staging_deployment',
            description: 'Deploy to staging environment',
            assignTo: 'devops-agent',
            priority: 'high',
            dependsOn: ['deployment_preparation']
          },
          {
            type: 'staging_verification',
            description: 'Verify staging deployment',
            assignTo: 'qa-agent',
            priority: 'high',
            dependsOn: ['staging_deployment']
          },
          {
            type: 'production_deployment',
            description: 'Deploy to production environment',
            assignTo: 'devops-agent',
            priority: 'critical',
            dependsOn: ['staging_verification']
          },
          {
            type: 'production_verification',
            description: 'Verify production deployment',
            assignTo: 'qa-agent',
            priority: 'critical',
            dependsOn: ['production_deployment']
          },
          {
            type: 'security_verification',
            description: 'Verify security in production',
            assignTo: 'security-agent',
            priority: 'high',
            dependsOn: ['production_deployment']
          }
        ]
      }
    };
    
    // Define phase transitions
    this.phaseTransitions = {
      initialization: {
        nextPhase: 'planning',
        conditions: [
          {
            type: 'agent_active',
            agents: ['planning-agent', 'coordination-agent']
          }
        ]
      },
      planning: {
        nextPhase: 'development',
        conditions: [
          {
            type: 'artifact_exists',
            artifactIds: ['requirements', 'architecture_design', 'security_plan']
          },
          {
            type: 'phase_tasks_completed',
            phase: 'planning'
          }
        ]
      },
      development: {
        nextPhase: 'integration',
        conditions: [
          {
            type: 'artifact_exists',
            artifactIds: ['frontend_code', 'backend_code', 'infrastructure_code']
          },
          {
            type: 'phase_tasks_completed',
            phase: 'development'
          }
        ]
      },
      integration: {
        nextPhase: 'deployment',
        conditions: [
          {
            type: 'artifact_exists',
            artifactIds: ['test_reports', 'integration_report']
          },
          {
            type: 'phase_tasks_completed',
            phase: 'integration'
          }
        ]
      },
      deployment: {
        nextPhase: 'completed',
        conditions: [
          {
            type: 'artifact_exists',
            artifactIds: ['deployment_report', 'verification_report']
          },
          {
            type: 'phase_tasks_completed',
            phase: 'deployment'
          }
        ]
      }
    };
  }

  /**
   * Initialize the workflow
   */
  async initialize() {
    try {
      // Initialize dependencies
      await this.taskRouter.initialize();
      await this.stateManager.initialize();
      
      // Load any custom workflow configurations
      const customWorkflow = await this.knowledgeBase.retrieveKnowledge('orchestration.custom_workflow');
      
      if (customWorkflow) {
        // Merge custom workflow configurations
        if (customWorkflow.phaseConfigurations) {
          this.phaseConfigurations = {
            ...this.phaseConfigurations,
            ...customWorkflow.phaseConfigurations
          };
        }
        
        if (customWorkflow.phaseTransitions) {
          this.phaseTransitions = {
            ...this.phaseTransitions,
            ...customWorkflow.phaseTransitions
          };
        }
      }
      
      // Register event listeners
      this.registerEventListeners();
      
      logger.info('Workflow initialized');
    } catch (error) {
      logger.error(`Error initializing workflow: ${error.message}`);
      throw error;
    }
  }

  /**
   * Register event listeners for workflow events
   */
  registerEventListeners() {
    // Listen for phase completion events
    this.messageQueue.subscribe('planning.completed', this.handlePlanningCompleted.bind(this));
    this.messageQueue.subscribe('development.completed', this.handleDevelopmentCompleted.bind(this));
    this.messageQueue.subscribe('integration.completed', this.handleIntegrationCompleted.bind(this));
    this.messageQueue.subscribe('deployment.completed', this.handleDeploymentCompleted.bind(this));
    
    // Listen for artifact creation events
    this.messageQueue.subscribe('artifact.created', this.handleArtifactCreated.bind(this));
    
    // Listen for task events
    this.messageQueue.subscribe('task.completed', this.handleTaskCompleted.bind(this));
    this.messageQueue.subscribe('task.failed', this.handleTaskFailed.bind(this));
    
    // Listen for phase transition requests
    this.messageQueue.subscribe('workflow.transition_phase', this.handlePhaseTransitionRequest.bind(this));
    
    // Listen for workflow customization requests
    this.messageQueue.subscribe('workflow.customize', this.handleWorkflowCustomization.bind(this));
  }

  /**
   * Start the workflow or a specific phase
   * @param {String} phase - Optional specific phase to start
   */
  async startWorkflow(phase = null) {
    try {
      // Get current system phase if not specified
      const currentPhase = phase || await this.stateManager.getCurrentPhase();
      
      logger.info(`Starting workflow at phase: ${currentPhase}`);
      
      // If starting from initialization, transition to planning
      if (currentPhase === 'initialization') {
        await this.checkAndTransitionPhase(currentPhase);
      } else {
        // Generate and assign tasks for the current phase
        await this.generatePhaseTasks(currentPhase);
      }
    } catch (error) {
      logger.error(`Error starting workflow: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if the current phase can transition to the next phase
   * @param {String} currentPhase - The current phase
   * @returns {Boolean} Whether the transition was performed
   */
  async checkAndTransitionPhase(currentPhase) {
    try {
      // Get transition rules for current phase
      const transitionRules = this.phaseTransitions[currentPhase];
      
      if (!transitionRules) {
        logger.warn(`No transition rules defined for phase ${currentPhase}`);
        return false;
      }
      
      // Check if all conditions are met
      const conditionsMet = await this.checkPhaseTransitionConditions(transitionRules.conditions);
      
      if (conditionsMet) {
        logger.info(`Conditions met for transition from ${currentPhase} to ${transitionRules.nextPhase}`);
        
        // Transition to next phase
        await this.transitionToPhase(transitionRules.nextPhase);
        return true;
      }
      
      logger.debug(`Conditions not yet met for transition from ${currentPhase}`);
      return false;
    } catch (error) {
      logger.error(`Error checking phase transition: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if all conditions for a phase transition are met
   * @param {Array} conditions - The conditions to check
   * @returns {Boolean} Whether all conditions are met
   */
  async checkPhaseTransitionConditions(conditions) {
    // If no conditions, consider them met
    if (!conditions || conditions.length === 0) {
      return true;
    }
    
    // Check each condition
    for (const condition of conditions) {
      const conditionMet = await this.checkTransitionCondition(condition);
      
      if (!conditionMet) {
        logger.debug(`Condition not met: ${condition.type}`);
        return false;
      }
    }
    
    return true;
  }

  /**
   * Check a specific transition condition
   * @param {Object} condition - The condition to check
   * @returns {Boolean} Whether the condition is met
   */
  async checkTransitionCondition(condition) {
    try {
      switch (condition.type) {
        case 'agent_active':
          // Check if all required agents are active
          return await this.checkAgentsActive(condition.agents);
          
        case 'artifact_exists':
          // Check if all required artifacts exist
          return await this.checkArtifactsExist(condition.artifactIds);
          
        case 'phase_tasks_completed':
          // Check if all tasks for a phase are completed
          return await this.checkPhaseTasksCompleted(condition.phase);
          
        case 'no_errors':
          // Check if there are no unresolved errors
          return await this.checkNoErrors();
          
        default:
          logger.warn(`Unknown transition condition type: ${condition.type}`);
          return false;
      }
    } catch (error) {
      logger.error(`Error checking transition condition: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if all specified agents are active
   * @param {Array} agentNames - The names of agents to check
   * @returns {Boolean} Whether all agents are active
   */
  async checkAgentsActive(agentNames) {
    try {
      const agents = await this.sharedState.get('agents') || {};
      
      for (const agentName of agentNames) {
        const agent = agents[agentName];
        
        if (!agent || agent.status !== 'active') {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      logger.error(`Error checking agents active: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if all specified artifacts exist
   * @param {Array} artifactIds - The IDs of artifacts to check
   * @returns {Boolean} Whether all artifacts exist
   */
  async checkArtifactsExist(artifactIds) {
    try {
      const artifacts = await this.sharedState.get('artifacts') || {};
      
      for (const artifactId of artifactIds) {
        const artifact = artifacts.latest[artifactId];
        
        if (!artifact) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      logger.error(`Error checking artifacts exist: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if all tasks for a phase are completed
   * @param {String} phase - The phase to check
   * @returns {Boolean} Whether all tasks for the phase are completed
   */
  async checkPhaseTasksCompleted(phase) {
    try {
      const tasks = await this.sharedState.get('tasks') || {};
      
      // Check if there are any pending or in-progress tasks for this phase
      const pendingTasks = tasks.pending.filter(task => task.phase === phase);
      const inProgressTasks = tasks.inProgress.filter(task => task.phase === phase);
      
      return pendingTasks.length === 0 && inProgressTasks.length === 0;
    } catch (error) {
      logger.error(`Error checking phase tasks completed: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if there are no unresolved errors
   * @returns {Boolean} Whether there are no unresolved errors
   */
  async checkNoErrors() {
    try {
      const issues = await this.sharedState.get('issues') || [];
      
      // Check if there are any unresolved errors
      const unresolvedErrors = issues.filter(issue => 
        !issue.resolved && issue.severity === 'error'
      );
      
      return unresolvedErrors.length === 0;
    } catch (error) {
      logger.error(`Error checking no errors: ${error.message}`);
      return false;
    }
  }

  /**
   * Transition to a new phase
   * @param {String} newPhase - The new phase to transition to
   */
  async transitionToPhase(newPhase) {
    try {
      logger.info(`Transitioning to phase: ${newPhase}`);
      
      // Update system state
      await this.stateManager.transitionToPhase(newPhase);
      
      // If transitioning to 'completed', finalize the project
      if (newPhase === 'completed') {
        await this.finalizeProject();
        return;
      }
      
      // Generate tasks for the new phase
      await this.generatePhaseTasks(newPhase);
      
      // Notify all agents about the phase transition
      await this.messageQueue.publish('workflow.phase_changed', {
        newPhase,
        phaseConfig: this.phaseConfigurations[newPhase],
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error transitioning to phase ${newPhase}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate tasks for a specific phase
   * @param {String} phase - The phase to generate tasks for
   */
  async generatePhaseTasks(phase) {
    try {
      const phaseConfig = this.phaseConfigurations[phase];
      
      if (!phaseConfig) {
        throw new Error(`No configuration found for phase ${phase}`);
      }
      
      logger.info(`Generating tasks for phase: ${phase}`);
      
      // Create tasks from templates
      for (const template of phaseConfig.taskTemplates) {
        // Create task object
        const task = {
          ...template,
          id: `${phase}-${template.type}-${Date.now()}`,
          phase,
          status: 'pending',
          createdAt: Date.now()
        };
        
        // Add task to the system
        await this.stateManager.addTask(task);
      }
      
      // Assign tasks that have no dependencies
      await this.assignReadyTasks(phase);
    } catch (error) {
      logger.error(`Error generating tasks for phase ${phase}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Assign tasks that are ready to be worked on
   * @param {String} phase - The phase to assign tasks for
   */
  async assignReadyTasks(phase = null) {
    try {
      // Get all pending tasks
      const tasks = await this.sharedState.get('tasks') || {};
      const pendingTasks = tasks.pending;
      
      if (pendingTasks.length === 0) {
        return;
      }
      
      // Filter by phase if specified
      const filteredTasks = phase
        ? pendingTasks.filter(task => task.phase === phase)
        : pendingTasks;
      
      // Find tasks with no unmet dependencies
      const readyTasks = filteredTasks.filter(task => {
        // If no dependencies, task is ready
        if (!task.dependsOn || task.dependsOn.length === 0) {
          return true;
        }
        
        // Check if all dependencies are completed
        const completedTasks = tasks.completed.map(t => t.id);
        return task.dependsOn.every(depId => {
          // Handle dependency by type instead of ID
          const depsByType = tasks.completed.filter(t => t.type === depId);
          return depsByType.length > 0 || completedTasks.includes(depId);
        });
      });
      
      if (readyTasks.length === 0) {
        logger.debug(`No ready tasks to assign for phase ${phase}`);
        return;
      }
      
      logger.info(`Assigning ${readyTasks.length} ready tasks`);
      
      // Get agent registry
      const agents = await this.sharedState.get('agents') || {};
      
      // Assign each ready task
      for (const task of readyTasks) {
        try {
          // If task has explicit agent assignment and agent is available, use that
          let assignedAgent = null;
          
          if (task.assignTo && agents[task.assignTo] && agents[task.assignTo].status === 'active') {
            assignedAgent = task.assignTo;
          } else {
            // Use task router to assign to best agent
            assignedAgent = await this.taskRouter.routeTask(task, agents);
          }
          
          if (assignedAgent) {
            // Update task status to in_progress
            await this.stateManager.updateTaskStatus(task.id, 'in_progress', {
              assignedAgent,
              startedAt: Date.now()
            });
            
            // Update agent workload
            await this.taskRouter.updateAgentWorkload(assignedAgent, 1);
            
            // Notify agent about the assigned task
            await this.messageQueue.publish(`${assignedAgent}.task_assigned`, {
              task,
              timestamp: Date.now()
            });
            
            logger.info(`Assigned task ${task.id} to agent ${assignedAgent}`);
          } else {
            logger.warn(`Could not find suitable agent for task ${task.id}`);
          }
        } catch (error) {
          logger.error(`Error assigning task ${task.id}: ${error.message}`);
          
          // Add to issues
          await this.stateManager.addIssue({
            type: 'task_assignment_error',
            taskId: task.id,
            message: error.message,
            timestamp: Date.now(),
            resolved: false
          });
        }
      }
    } catch (error) {
      logger.error(`Error assigning ready tasks: ${error.message}`);
      throw error;
    }
  }

  /**
   * Finalize the project after completion
   */
  async finalizeProject() {
    try {
      logger.info('Finalizing project');
      
      // Generate final report
      const artifacts = await this.sharedState.get('artifacts') || {};
      const allTasks = await this.sharedState.get('tasks') || {};
      const issues = await this.sharedState.get('issues') || [];
      
      const finalReport = {
        completionTime: Date.now(),
        artifacts: artifacts.latest,
        taskStats: {
          total: allTasks.completed.length + allTasks.failed.length,
          completed: allTasks.completed.length,
          failed: allTasks.failed.length
        },
        issueStats: {
          total: issues.length,
          resolved: issues.filter(i => i.resolved).length,
          unresolved: issues.filter(i => !i.resolved).length
        }
      };
      
      // Store final report
      await this.stateManager.trackArtifact('final_report', 'final_report', finalReport);
      
      // Notify all agents about project completion
      await this.messageQueue.publish('workflow.project_completed', {
        finalReport,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error finalizing project: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle planning completed events
   * @param {Object} message - The message containing planning completion info
   */
  async handlePlanningCompleted(message) {
    logger.info(`Planning phase completed: ${JSON.stringify(message)}`);
    
    // Check and transition to the next phase
    await this.checkAndTransitionPhase('planning');
  }

  /**
   * Handle development completed events
   * @param {Object} message - The message containing development completion info
   */
  async handleDevelopmentCompleted(message) {
    logger.info(`Development phase completed: ${JSON.stringify(message)}`);
    
    // Check and transition to the next phase
    await this.checkAndTransitionPhase('development');
  }

  /**
   * Handle integration completed events
   * @param {Object} message - The message containing integration completion info
   */
  async handleIntegrationCompleted(message) {
    logger.info(`Integration phase completed: ${JSON.stringify(message)}`);
    
    // Check and transition to the next phase
    await this.checkAndTransitionPhase('integration');
  }

  /**
   * Handle deployment completed events
   * @param {Object} message - The message containing deployment completion info
   */
  async handleDeploymentCompleted(message) {
    logger.info(`Deployment phase completed: ${JSON.stringify(message)}`);
    
    // Check and transition to the next phase
    await this.checkAndTransitionPhase('deployment');
  }

  /**
   * Handle artifact created events
   * @param {Object} message - The message containing artifact info
   */
  async handleArtifactCreated(message) {
    const { artifactType, artifactId, metadata } = message;
    
    logger.info(`Artifact created: ${artifactType} - ${artifactId}`);
    
    // Track the artifact
    await this.stateManager.trackArtifact(artifactType, artifactId, metadata);
    
    // Check if this artifact completes a phase transition condition
    const currentPhase = await this.stateManager.getCurrentPhase();
    await this.checkAndTransitionPhase(currentPhase);
  }

  /**
   * Handle task completed events
   * @param {Object} message - The message containing task completion info
   */
  async handleTaskCompleted(message) {
    const { taskId, result, agentName } = message;
    
    logger.info(`Task ${taskId} completed by ${agentName}`);
    
    // Update agent workload
    await this.taskRouter.updateAgentWorkload(agentName, -1);
    
    // Check if this completion enables any dependent tasks
    await this.assignReadyTasks();
    
    // Check if all tasks for the current phase are completed
    const currentPhase = await this.stateManager.getCurrentPhase();
    const allTasksCompleted = await this.checkPhaseTasksCompleted(currentPhase);
    
    if (allTasksCompleted) {
      // Notify about phase completion
      await this.messageQueue.publish(`${currentPhase}.completed`, {
        phase: currentPhase,
        timestamp: Date.now()
      });
      
      // Check for phase transition
      await this.checkAndTransitionPhase(currentPhase);
    }
  }

  /**
   * Handle task failed events
   * @param {Object} message - The message containing task failure info
   */
  async handleTaskFailed(message) {
    const { taskId, error, agentName } = message;
    
    logger.error(`Task ${taskId} failed by ${agentName}: ${error}`);
    
    // Update agent workload
    await this.taskRouter.updateAgentWorkload(agentName, -1);
    
    // Add to issues
    await this.stateManager.addIssue({
      type: 'task_failure',
      taskId,
      agentName,
      message: error,
      timestamp: Date.now(),
      resolved: false
    });
  }

  /**
   * Handle phase transition request events
   * @param {Object} message - The message containing transition request
   */
  async handlePhaseTransitionRequest(message) {
    const { targetPhase, force, requesterId } = message;
    
    logger.info(`Phase transition requested by ${requesterId} to ${targetPhase}`);
    
    try {
      const currentPhase = await this.stateManager.getCurrentPhase();
      
      // If forcing, bypass checks
      if (force) {
        await this.transitionToPhase(targetPhase);
        
        // Notify requestor about successful transition
        await this.messageQueue.publish(`${requesterId}.phase_transition_complete`, {
          previousPhase: currentPhase,
          currentPhase: targetPhase,
          forced: true
        });
      } else {
        // Check if transition is valid
        const transitionRules = this.phaseTransitions[currentPhase];
        
        if (!transitionRules || transitionRules.nextPhase !== targetPhase) {
          throw new Error(`Invalid phase transition from ${currentPhase} to ${targetPhase}`);
        }
        
        // Check conditions
        const conditionsMet = await this.checkPhaseTransitionConditions(transitionRules.conditions);
        
        if (conditionsMet) {
          await this.transitionToPhase(targetPhase);
          
          // Notify requestor about successful transition
          await this.messageQueue.publish(`${requesterId}.phase_transition_complete`, {
            previousPhase: currentPhase,
            currentPhase: targetPhase,
            forced: false
          });
        } else {
          throw new Error(`Transition conditions not met for ${currentPhase} to ${targetPhase}`);
        }
      }
    } catch (error) {
      logger.error(`Error handling phase transition request: ${error.message}`);
      
      // Notify requestor about failure
      await this.messageQueue.publish(`${requesterId}.phase_transition_failed`, {
        error: error.message,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle workflow customization events
   * @param {Object} message - The message containing customization request
   */
  async handleWorkflowCustomization(message) {
    const { customizations, requesterId } = message;
    
    logger.info(`Workflow customization requested by ${requesterId}`);
    
    try {
      // Apply customizations to phase configurations
      if (customizations.phaseConfigurations) {
        for (const [phase, config] of Object.entries(customizations.phaseConfigurations)) {
          this.phaseConfigurations[phase] = {
            ...this.phaseConfigurations[phase],
            ...config
          };
        }
      }
      
      // Apply customizations to phase transitions
      if (customizations.phaseTransitions) {
        for (const [phase, config] of Object.entries(customizations.phaseTransitions)) {
          this.phaseTransitions[phase] = {
            ...this.phaseTransitions[phase],
            ...config
          };
        }
      }
      
      // Store customized workflow
      await this.knowledgeBase.storeKnowledge('orchestration.custom_workflow', {
        phaseConfigurations: this.phaseConfigurations,
        phaseTransitions: this.phaseTransitions
      });
      
      // Notify requestor about successful customization
      await this.messageQueue.publish(`${requesterId}.workflow_customization_complete`, {
        timestamp: Date.now()
      });
      
      logger.info('Applied workflow customizations');
    } catch (error) {
      logger.error(`Error handling workflow customization: ${error.message}`);
      
      // Notify requestor about failure
      await this.messageQueue.publish(`${requesterId}.workflow_customization_failed`, {
        error: error.message,
        timestamp: Date.now()
      });
    }
  }
}

module.exports = Workflow;
