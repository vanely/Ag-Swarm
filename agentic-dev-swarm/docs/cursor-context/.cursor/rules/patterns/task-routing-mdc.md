.cursor/rules/patterns/task-routing.mdc

---
description: Deterministic task routing across Planner, Coder, Critic and extensions
globs: "**/*"
priority: high
---

# Task Routing

## Overview
Route units of work to the optimal agent based on role, complexity, and dependencies. Enforce multi-agent review gates before promotion. This ensures that work is processed by the most appropriate specialized agents, dependencies are respected, and quality gates are enforced throughout the development process.

## Requirements
- Declare upstream/downstream dependencies explicitly:
  - Auto-activate downstream tasks when upstream tasks complete
  - Block execution until dependencies are satisfied
  - Maintain a directed acyclic graph (DAG) of task dependencies
  - Track and visualize the critical path
  - Handle dependency failures with appropriate notifications

- Route tasks to specialized agents based on type:
  - **UI Specialist**: Frontend components, styling, interactions
  - **API Builder**: Backend endpoints, middleware, data models
  - **Pipeline Master**: CI/CD, deployment, infrastructure
  - **Security Specialist**: Auth, encryption, secure configurations
  - **Data Architect**: Database, caching, data flows
  - **Speed Demon**: Performance optimization, scaling
  - **Critic**: Code review, testing, quality assurance
  - **Planner/Architect**: System design, task breakdown, coordination

- Support parallel execution patterns:
  - Fan-out: Split work into parallel tasks
  - Fan-in: Aggregate results from multiple tasks
  - Apply quality gates at convergence points
  - Route to Critic for approval before merging
  - Route to Security Specialist for security-critical changes

- Dynamic routing based on metrics:
  - Route to Speed Demon when SLOs are at risk
  - Increase parallelization when deadlines are tight
  - Adjust priorities based on dependency status
  - Auto-escalate blocked or delayed tasks

## Examples

### ✅ Good Example
```typescript
// task-router.ts

import { TaskGraph } from './task-graph';
import { AgentRegistry } from './agent-registry';
import { Task, TaskStatus, TaskType, AgentRole } from './types';
import { EventBus } from './event-bus';

export class TaskRouter {
  constructor(
    private taskGraph: TaskGraph,
    private agentRegistry: AgentRegistry,
    private eventBus: EventBus
  ) {
    this.initEventListeners();
  }

  private initEventListeners(): void {
    this.eventBus.on('task.completed', this.handleTaskCompleted.bind(this));
    this.eventBus.on('task.failed', this.handleTaskFailed.bind(this));
    this.eventBus.on('slo.breach', this.handleSLOBreach.bind(this));
  }

  /**
   * Add a task to the system with its dependencies
   */
  async addTask(task: Task, dependencies: string[] = []): Promise<string> {
    // Validate task
    this.validateTask(task);
    
    // Add to task graph
    await this.taskGraph.addTask(task, dependencies);
    
    // If task has no dependencies, or all dependencies are already completed,
    // route it immediately
    if (await this.taskGraph.isReady(task.id)) {
      await this.routeTask(task);
    } else {
      // Otherwise, it will be routed when dependencies complete
      console.log(`Task ${task.id} waiting for dependencies`);
    }
    
    return task.id;
  }
  
  /**
   * Handle completed task event
   */
  private async handleTaskCompleted(taskId: string): Promise<void> {
    // Get all tasks that depend on this one
    const dependentTasks = await this.taskGraph.getDependentTasks(taskId);
    
    // For each dependent task, check if all its dependencies are now completed
    for (const dependentTask of dependentTasks) {
      if (await this.taskGraph.isReady(dependentTask.id)) {
        // All dependencies satisfied, route the task
        await this.routeTask(dependentTask);
      }
    }
    
    // Check if this was the last task in a fan-out pattern
    // that requires aggregation by the Critic
    const task = await this.taskGraph.getTask(taskId);
    if (task.requiresCriticAfter) {
      const siblings = await this.taskGraph.getSiblingTasks(taskId);
      const allCompleted = siblings.every(t => t.status === TaskStatus.COMPLETED);
      
      if (allCompleted) {
        // Create a review task for the Critic
        const reviewTask: Task = {
          id: `review-${Date.now()}`,
          type: TaskType.REVIEW,
          title: `Review ${siblings.length} tasks for ${task.context}`,
          description: `Perform a comprehensive review of all tasks related to ${task.context}`,
          status: TaskStatus.PENDING,
          priority: task.priority,
          context: task.context,
          metadata: {
            tasks: siblings.map(t => t.id),
            criteria: task.metadata?.reviewCriteria || ['functionality', 'code_quality', 'tests']
          }
        };
        
        // Add with dependencies to all siblings
        await this.addTask(reviewTask, siblings.map(t => t.id));
      }
    }
  }
  
  /**
   * Handle failed task event
   */
  private async handleTaskFailed(taskId: string, error: any): Promise<void> {
    // Get the task
    const task = await this.taskGraph.getTask(taskId);
    
    // Update task status
    await this.taskGraph.updateTask(taskId, { status: TaskStatus.FAILED, error });
    
    // Get dependent tasks
    const dependentTasks = await this.taskGraph.getDependentTasks(taskId);
    
    // Mark all dependent tasks as blocked
    for (const dependentTask of dependentTasks) {
      await this.taskGraph.updateTask(dependentTask.id, { 
        status: TaskStatus.BLOCKED,
        error: `Blocked by failure of dependency: ${taskId}`
      });
    }
    
    // Notify about the failure
    this.eventBus.emit('task.blocked', { 
      taskId, 
      dependentTasks: dependentTasks.map(t => t.id),
      error
    });
  }
  
  /**
   * Handle SLO breach event
   */
  private async handleSLOBreach(sloData: any): Promise<void> {
    const { context, metric, threshold, actual } = sloData;
    
    // Create a performance optimization task
    const optimizationTask: Task = {
      id: `optimize-${Date.now()}`,
      type: TaskType.OPTIMIZE,
      title: `Optimize ${metric} for ${context}`,
      description: `Performance optimization required: ${metric} is ${actual} but threshold is ${threshold}`,
      status: TaskStatus.PENDING,
      priority: 'high', // Performance issues are high priority
      context,
      metadata: {
        slo: sloData,
        suggestedImprovements: this.generateImprovementSuggestions(sloData)
      }
    };
    
    // Add the task
    await this.addTask(optimizationTask);
    
    // Route directly to Speed Demon
    await this.routeTaskToRole(optimizationTask, AgentRole.SPEED_DEMON);
  }
  
  /**
   * Route a task to the appropriate agent based on its type
   */
  private async routeTask(task: Task): Promise<void> {
    // Map task types to agent roles
    const roleMap: Record<TaskType, AgentRole> = {
      [TaskType.PLAN]: AgentRole.PLANNER,
      [TaskType.DESIGN]: AgentRole.ARCHITECT,
      [TaskType.CODE_UI]: AgentRole.UI_SPECIALIST,
      [TaskType.CODE_API]: AgentRole.API_BUILDER,
      [TaskType.CODE_DATA]: AgentRole.DATA_ARCHITECT,
      [TaskType.TEST]: AgentRole.CRITIC,
      [TaskType.REVIEW]: AgentRole.CRITIC,
      [TaskType.OPTIMIZE]: AgentRole.SPEED_DEMON,
      [TaskType.DEPLOY]: AgentRole.PIPELINE_MASTER,
      [TaskType.SECURE]: AgentRole.SECURITY_SPECIALIST,
    };
    
    const role = roleMap[task.type] || AgentRole.PLANNER; // Default to Planner
    
    await this.routeTaskToRole(task, role);
  }
  
  /**
   * Route a task to a specific agent role
   */
  private async routeTaskToRole(task: Task, role: AgentRole): Promise<void> {
    // Find available agents for this role
    const availableAgents = this.agentRegistry.getAgentsByRole(role);
    
    if (!availableAgents.length) {
      console.error(`No available agents for role ${role}`);
      return;
    }
    
    // Select an agent (could implement more sophisticated selection)
    const agent = availableAgents[0];
    
    // Update task status
    await this.taskGraph.updateTask(task.id, {
      status: TaskStatus.ASSIGNED,
      assignedTo: agent.id
    });
    
    // Publish task to the agent
    this.eventBus.emit('task.assigned', {
      taskId: task.id,
      agentId: agent.id,
      task
    });
    
    console.log(`Routed task ${task.id} to ${agent.id} (${role})`);
  }
  
  /**
   * Validate task structure
   */
  private validateTask(task: Task): void {
    if (!task.id) throw new Error('Task must have an ID');
    if (!task.type) throw new Error('Task must have a type');
    if (!task.title) throw new Error('Task must have a title');
    
    // Validate based on task type
    switch (task.type) {
      case TaskType.CODE_UI:
        if (!task.metadata?.components) {
          throw new Error('UI tasks must specify components to implement');
        }
        break;
      case TaskType.CODE_API:
        if (!task.metadata?.endpoints) {
          throw new Error('API tasks must specify endpoints to implement');
        }
        break;
      // Add validation for other task types
    }
  }
  
  /**
   * Generate improvement suggestions based on SLO breach
   */
  private generateImprovementSuggestions(sloData: any): string[] {
    const { metric } = sloData;
    
    // Suggestions based on metric type
    switch (metric) {
      case 'response_time':
        return [
          'Implement caching for frequently accessed data',
          'Optimize database queries',
          'Consider asynchronous processing for non-critical operations',
          'Add indexes to frequently queried columns',
          'Implement CDN for static assets'
        ];
      case 'memory_usage':
        return [
          'Check for memory leaks',
          'Optimize data structures to reduce memory footprint',
          'Implement pagination for large data sets',
          'Review connection pooling settings',
          'Consider vertical scaling of instances'
        ];
      default:
        return ['Review code for optimization opportunities'];
    }
  }
}
```

### ❌ Bad Example
```typescript
// bad-task-handling.ts

class SimpleTaskHandler {
  // BAD: No specialized agents or routing logic
  async handleTask(task: any): Promise<void> {
    // No validation of task structure
    
    // No dependency tracking or management
    
    // No specialized routing - one agent does everything
    try {
      switch (task.type) {
        case 'UI':
          await this.implementUI(task);
          break;
        case 'API':
          await this.implementAPI(task);
          break;
        case 'TEST':
          await this.runTests(task);
          break;
        // More cases...
        default:
          console.log(`Unknown task type: ${task.type}`);
      }
      
      console.log(`Task ${task.id} completed`);
    } catch (error) {
      console.error(`Task ${task.id} failed:`, error);
      // No proper error handling or notification
    }
  }
  
  // BAD: One agent trying to do everything rather than using specialists
  private async implementUI(task: any): Promise<void> { /* ... */ }
  private async implementAPI(task: any): Promise<void> { /* ... */ }
  private async runTests(task: any): Promise<void> { /* ... */ }
}
```

## Implementation Notes
- Maintain a routing matrix mapping labels → agent roles; keep under version control
- Visualize the task dependency graph for monitoring and debugging
- Implement automatic rerouting for SLO breaches
- Create dashboards for monitoring task status and bottlenecks
- Track metrics on agent utilization and task completion times
- Implement timeout handling for stuck tasks
- Create alerting for blocked critical path tasks
- Document agent capabilities and specializations
- Perform regular reviews of routing efficiency
