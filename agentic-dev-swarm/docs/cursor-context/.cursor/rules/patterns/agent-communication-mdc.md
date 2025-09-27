---
description: Deterministic inter-agent messaging and shared-state patterns
globs: "**/*"
priority: high
---

# Agent Communication

## Overview
Use queue-backed, schema-validated messages with no hidden coupling between agents. Maintain versioned message contracts and provenance in shared state. This ensures reliable, traceable communication between all agents in the swarm while preventing tight coupling or unpredictable behaviors.

## Requirements
- Pattern: **Broadcast → Claim → Execute → Report** with deduplication + retries:
  - **Broadcast**: Publish task/event to appropriate queue with full context
  - **Claim**: Worker agent claims task with visibility timeout to prevent duplicates
  - **Execute**: Agent processes task and prepares results
  - **Report**: Agent publishes completion/failure event with results/errors

- Transport: Redis/Kafka only with required metadata:
  - Include correlation IDs to trace request flows
  - Include causal links to establish event relationships
  - Use topics/channels organized by domain and event type
  - Implement TTL (Time To Live) for all messages
  - Enforce message schemas and validation
  - Configure proper retention policies

- Shared knowledge management:
  - Embed vectors with document/source references
  - Never store raw secrets or credentials
  - Include provenance (who/when/why) for all stored items
  - Implement explicit versioning for all shared state
  - Use optimistic locking for concurrent updates

- Versioning requirements:
  - Version-control all protocol changes
  - Generate changelogs automatically
  - Maintain backward compatibility
  - Document breaking changes
  - Test with previous versions

## Examples

### ✅ Good Example
```typescript
// agent-messaging/task-processor.ts

import { KafkaClient, Producer, Consumer } from 'kafka-node';
import { v4 as uuidv4 } from 'uuid';
import { taskSchema, TaskMessage, CompletionMessage, ClaimMessage } from './schemas';

export class TaskProcessor {
  private producer: Producer;
  private consumer: Consumer;
  private workerId: string = uuidv4();
  
  constructor(private kafkaClient: KafkaClient, private agentType: string) {
    this.producer = new Producer(kafkaClient);
    // Set up consumer with appropriate group ID
    this.consumer = new Consumer(
      kafkaClient,
      [{ topic: 'tasks', partition: 0 }],
      { groupId: `${agentType}-group` }
    );
    
    this.initListeners();
  }
  
  private initListeners(): void {
    // Listen for new tasks
    this.consumer.on('message', async (message) => {
      try {
        // Parse and validate the message
        const taskMessage = JSON.parse(message.value.toString()) as TaskMessage;
        const validationResult = taskSchema.safeParse(taskMessage);
        
        if (!validationResult.success) {
          console.error('Invalid task message:', validationResult.error);
          return;
        }
        
        const task = validationResult.data;
        
        // Check if this agent can process this task type
        if (!this.canProcessTaskType(task.payload.taskType)) {
          return; // Not our task type, ignore
        }
        
        // Try to claim the task
        await this.claimTask(task);
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });
  }
  
  private canProcessTaskType(taskType: string): boolean {
    // Check if this agent type can handle this task type
    const taskTypeMap: Record<string, string[]> = {
      'planner': ['PLAN.CREATE', 'PLAN.UPDATE'],
      'coder': ['CODE.IMPLEMENTATION', 'CODE.REFACTOR'],
      'critic': ['CODE.REVIEW', 'TEST.VALIDATE'],
      // Add other agent types and their tasks
    };
    
    return taskTypeMap[this.agentType]?.includes(taskType) || false;
  }
  
  private async claimTask(task: TaskMessage): Promise<void> {
    // Prepare claim message
    const claimMessage: ClaimMessage = {
      type: 'TASK.CLAIMED',
      v: 1,
      correlationId: task.correlationId,
      timestamp: new Date().toISOString(),
      payload: {
        taskId: task.payload.taskId,
        claimedBy: this.workerId,
        agentType: this.agentType,
        claimedAt: new Date().toISOString(),
        estimatedCompletion: this.estimateCompletion(task)
      }
    };
    
    // Publish claim
    await this.publishMessage('task-claims', claimMessage);
    
    // Execute the task
    try {
      const result = await this.executeTask(task);
      await this.reportCompletion(task, result);
    } catch (error) {
      await this.reportFailure(task, error);
    }
  }
  
  private async executeTask(task: TaskMessage): Promise<any> {
    // Implementation depends on task type
    console.log(`Executing task: ${task.payload.taskId} of type ${task.payload.taskType}`);
    
    // Simulate task execution
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Return result
    return {
      status: 'SUCCESS',
      output: `Completed ${task.payload.taskType}`
    };
  }
  
  private async reportCompletion(task: TaskMessage, result: any): Promise<void> {
    const completionMessage: CompletionMessage = {
      type: 'TASK.COMPLETED',
      v: 1,
      correlationId: task.correlationId,
      timestamp: new Date().toISOString(),
      payload: {
        taskId: task.payload.taskId,
        completedBy: this.workerId,
        agentType: this.agentType,
        completedAt: new Date().toISOString(),
        result
      }
    };
    
    await this.publishMessage('task-completions', completionMessage);
  }
  
  private async reportFailure(task: TaskMessage, error: any): Promise<void> {
    const failureMessage = {
      type: 'TASK.FAILED',
      v: 1,
      correlationId: task.correlationId,
      timestamp: new Date().toISOString(),
      payload: {
        taskId: task.payload.taskId,
        failedBy: this.workerId,
        agentType: this.agentType,
        failedAt: new Date().toISOString(),
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code || 'UNKNOWN_ERROR'
        }
      }
    };
    
    await this.publishMessage('task-failures', failureMessage);
  }
  
  private async publishMessage(topic: string, message: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.producer.send([
        {
          topic,
          messages: JSON.stringify(message),
          key: message.payload.taskId
        }
      ], (err, result) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  
  private estimateCompletion(task: TaskMessage): string {
    // Simple estimation logic based on task type
    const now = new Date();
    
    // Add time based on task complexity
    const complexityMap: Record<string, number> = {
      'PLAN.CREATE': 30, // 30 minutes
      'CODE.IMPLEMENTATION': 60, // 60 minutes
      // Add other task types
    };
    
    const minutesToAdd = complexityMap[task.payload.taskType] || 15; // Default 15 minutes
    now.setMinutes(now.getMinutes() + minutesToAdd);
    
    return now.toISOString();
  }
}
```

### ❌ Bad Example
```typescript
// agent-coupling-antipattern.ts

// BAD: Direct coupling between agents via file system
class AgentA {
  async processTask(taskId: string): Promise<void> {
    const result = await this.doSomeWork();
    
    // Directly writing to a file that Agent B will read
    // Problems:
    // 1. No schema validation
    // 2. Tight coupling between agents
    // 3. No retry mechanism
    // 4. No visibility timeout
    // 5. No correlation tracking
    // 6. No versioning
    fs.writeFileSync(`/tmp/agent-outputs/${taskId}.json`, JSON.stringify(result));
  }
}

class AgentB {
  async checkForResults(): Promise<void> {
    // Polling the file system - inefficient
    fs.readdir('/tmp/agent-outputs', (err, files) => {
      if (err) throw err;
      
      // Process any files found
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(`/tmp/agent-outputs/${file}`, 'utf8'));
          this.handleResult(data);
          
          // Remove the file after processing
          fs.unlinkSync(`/tmp/agent-outputs/${file}`);
        } catch (error) {
          console.error(`Error processing ${file}:`, error);
        }
      }
    });
  }
  
  // Set up polling at regular intervals
  start(): void {
    setInterval(() => this.checkForResults(), 5000);
  }
}
```

## Implementation Notes
- Provide a contract test suite that replays historical messages across versions
- Implement message schema validation with clear error messages
- Create circuit breakers for handling downstream failures
- Maintain a central registry of all message types and schemas
- Document retry policies for each message type
- Monitor queue depths and processing times
- Implement dead-letter queues for messages that fail repeatedly
- Create visualization of message flows for documentation
- Conduct chaos tests to verify resilience
