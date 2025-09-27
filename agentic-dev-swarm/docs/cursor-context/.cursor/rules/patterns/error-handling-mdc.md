---
description: Swarm-wide error taxonomies, retries, fallbacks, and rollbacks
globs: "**/*"
priority: high
---

# Error Handling & Resilience

## Overview
Prevent cascading failures across the agent swarm by implementing comprehensive error handling. Prefer idempotent operations, compensating transactions, and fast rollback to stable states. This ensures that errors are contained, systems can recover gracefully, and operations are reliably completed even in the face of transient failures.

## Requirements
- Standard error taxonomy across all agents and services:
  - **`ValidationError`**: Invalid input (never retry)
  - **`AuthorizationError`**: Permission denied (never retry)
  - **`TransientError`**: Temporary infrastructure issue (retry with backoff)
  - **`PermanentError`**: Unrecoverable system error (no retry, alert)
  - **`SecurityError`**: Security violation (log, alert, never retry)

- Implement retry strategies:
  - Use exponential backoff with jitter for `TransientError`
  - **Never** retry `ValidationError` or `SecurityError`
  - Implement retry limits to prevent infinite loops
  - Document retry policies for each service
  - Monitor retry counts for alerting

- Write idempotent handlers for all operations:
  - Include unique `operationId` for deduplication
  - Use "at-least-once" delivery semantics
  - Check for existing outcomes before processing
  - Gracefully handle duplicate requests
  - Avoid non-idempotent operations where possible

- Implement compensating actions for multi-stage operations:
  - Document in runbooks and error recovery procedures
  - Test compensating actions in chaos engineering
  - Maintain a state machine for complex workflows
  - Automate compensation where possible
  - Provide manual intervention procedures for critical failures

- Centralized error monitoring and alerting:
  - Capture all errors in centralized logging
  - Define SLOs for error rates and response times
  - Set up alerts for error thresholds
  - Configure on-call dashboards and escalations
  - Perform regular error analysis and trend monitoring

## Examples

### ✅ Good Example
```typescript
// payment-processor.ts

import { v4 as uuidv4 } from 'uuid';
import { retry } from 'exponential-backoff';
import { Redis } from 'ioredis';
import { PaymentService } from './payment-service';
import { InventoryService } from './inventory-service';
import { Logger } from './logger';

// Define error types
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}

class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export class OrderProcessor {
  constructor(
    private paymentService: PaymentService,
    private inventoryService: InventoryService,
    private redis: Redis,
    private logger: Logger
  ) {}

  async processOrder(order: Order): Promise<OrderResult> {
    // Generate a unique operation ID for idempotency
    const operationId = order.id || uuidv4();
    
    try {
      // Check if this operation was already processed (idempotency)
      const existingResult = await this.redis.get(`order:${operationId}:result`);
      if (existingResult) {
        return JSON.parse(existingResult);
      }

      // Validate order
      this.validateOrder(order);
      
      // Reserve inventory first
      await this.reserveInventory(order, operationId);
      
      try {
        // Process payment
        const paymentResult = await this.processPayment(order, operationId);
        
        // Confirm inventory reservation
        await this.confirmInventory(order, operationId);
        
        // Store the result for idempotency
        const result = { success: true, orderId: operationId, paymentId: paymentResult.paymentId };
        await this.redis.set(`order:${operationId}:result`, JSON.stringify(result));
        
        return result;
      } catch (error) {
        // If payment fails, release inventory
        this.logger.error(`Payment failed for order ${operationId}. Releasing inventory.`, { error });
        await this.releaseInventory(order, operationId);
        
        // Re-throw the error
        throw error;
      }
    } catch (error) {
      // Handle different error types
      if (error instanceof ValidationError) {
        this.logger.warn(`Validation error for order ${operationId}`, { error });
        const result = { success: false, orderId: operationId, error: error.message, code: 'VALIDATION_ERROR' };
        await this.redis.set(`order:${operationId}:result`, JSON.stringify(result));
        return result;
      } else if (error instanceof TransientError) {
        this.logger.warn(`Transient error for order ${operationId}`, { error });
        throw error; // Let the caller retry with backoff
      } else {
        // Permanent errors
        this.logger.error(`Permanent error for order ${operationId}`, { error });
        const result = { success: false, orderId: operationId, error: 'System error', code: 'SYSTEM_ERROR' };
        await this.redis.set(`order:${operationId}:result`, JSON.stringify(result));
        return result;
      }
    }
  }
  
  private validateOrder(order: Order): void {
    if (!order.items || order.items.length === 0) {
      throw new ValidationError('Order must contain at least one item');
    }
    
    if (!order.paymentInfo || !order.paymentInfo.method) {
      throw new ValidationError('Payment information is required');
    }
    
    // More validation rules...
  }
  
  private async reserveInventory(order: Order, operationId: string): Promise<void> {
    try {
      await retry(
        async () => {
          await this.inventoryService.reserve({
            operationId,
            items: order.items.map(item => ({ 
              productId: item.productId, 
              quantity: item.quantity 
            }))
          });
        },
        {
          retry: (e) => e instanceof TransientError,
          maxRetries: 3,
          startingDelay: 500, // ms
        }
      );
    } catch (error) {
      if (error instanceof TransientError) {
        // Convert to permanent after retries are exhausted
        throw new PermanentError(`Failed to reserve inventory after retries: ${error.message}`);
      }
      throw error;
    }
  }
  
  private async processPayment(order: Order, operationId: string): Promise<PaymentResult> {
    try {
      return await retry(
        async () => {
          return await this.paymentService.processPayment({
            operationId,
            amount: this.calculateTotal(order),
            currency: order.currency || 'USD',
            paymentMethod: order.paymentInfo
          });
        },
        {
          retry: (e) => e instanceof TransientError,
          maxRetries: 2,
          startingDelay: 1000, // ms
        }
      );
    } catch (error) {
      if (error instanceof TransientError) {
        // Convert to permanent after retries are exhausted
        throw new PermanentError(`Failed to process payment after retries: ${error.message}`);
      }
      throw error;
    }
  }
  
  private async confirmInventory(order: Order, operationId: string): Promise<void> {
    try {
      await retry(
        async () => {
          await this.inventoryService.confirm({
            operationId,
            items: order.items.map(item => ({ 
              productId: item.productId, 
              quantity: item.quantity 
            }))
          });
        },
        {
          retry: (e) => e instanceof TransientError,
          maxRetries: 3,
          startingDelay: 500, // ms
        }
      );
    } catch (error) {
      this.logger.error(`Failed to confirm inventory for order ${operationId}. Manual intervention required.`, { error });
      // This is serious as payment was taken but inventory wasn't confirmed
      // Trigger an alert for manual intervention
      await this.triggerAlert({
        level: 'CRITICAL',
        title: `Inventory confirmation failed for paid order ${operationId}`,
        details: { order, error: error.message },
        actionRequired: 'Manual confirmation of inventory needed'
      });
    }
  }
  
  private async releaseInventory(order: Order, operationId: string): Promise<void> {
    try {
      await retry(
        async () => {
          await this.inventoryService.release({
            operationId,
            items: order.items.map(item => ({ 
              productId: item.productId, 
              quantity: item.quantity 
            }))
          });
        },
        {
          retry: (e) => e instanceof TransientError,
          maxRetries: 5, // More retries for compensating actions
          startingDelay: 1000, // ms
        }
      );
    } catch (error) {
      this.logger.error(`Failed to release inventory for order ${operationId}. Manual intervention required.`, { error });
      // This requires manual intervention
      await this.triggerAlert({
        level: 'CRITICAL',
        title: `Inventory release failed for order ${operationId}`,
        details: { order, error: error.message },
        actionRequired: 'Manual release of inventory needed'
      });
    }
  }
  
  private calculateTotal(order: Order): number {
    return order.items.reduce((total, item) => total + (item.price * item.quantity), 0);
  }
  
  private async triggerAlert(alert: Alert): Promise<void> {
    // Alert implementation
    this.logger.alert(alert.title, alert);
    // Send to alerting system, pager duty, etc.
  }
}
```

### ❌ Bad Example
```typescript
// bad-error-handling.ts

class OrderService {
  async processOrder(order: any) {
    try {
      // No validation of input
      
      // No idempotency check
      
      // Directly call services without retries
      const inventory = await this.inventoryService.reserve(order.items);
      const payment = await this.paymentGateway.charge(order.payment);
      
      // No transactional integrity - if the following step fails,
      // payment is still charged but inventory isn't confirmed
      await this.inventoryService.confirm(order.items);
      
      // Silent catch - swallows all errors!
      return { success: true };
    } catch (e) {
      console.log("Error processing order:", e);
      
      // No proper error handling, no compensating actions
      // No error categorization
      // No alerting
      // No logging of specific error details
      
      // Generic error response without details
      return { success: false };
    }
  }
}
```

## Implementation Notes
- Exercise chaos tests in CI for top 5 failure modes
- Create a shared error library with standard error types
- Implement correlation IDs for request tracing
- Document error handling patterns in developer guides
- Set up automated monitoring for error rates by category
- Create runbooks for handling each error scenario
- Implement circuit breakers for external dependencies
- Use feature flags to disable failing components
- Test compensating transactions in regular disaster recovery exercises
