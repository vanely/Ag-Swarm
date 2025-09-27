# Optimal `.cursor/rules/` Directory Structure

### **Directory Layout**
```
/Users/vnly_/Projects/ag-swarm/agentic-dev-swarm/
├── .cursor/
│   ├── rules.mdc                    ← Main configuration file
│   └── rules/
│       ├── core/
│       │   ├── code-style.mdc
│       │   ├── general.mdc
│       │   └── architecture.mdc
│       ├── language/
│       │   └── javascript.mdc
│       ├── patterns/
│       │   ├── agent-communication.mdc
│       │   ├── error-handling.mdc
│       │   └── task-routing.mdc
│       ├── planning/
│       │   ├── plan-generic.mdc
│       │   └── plan-specs.mdc
│       └── tools/
│           ├── git.mdc
│           └── deployment.mdc
├── src/
├── README.md
└── ...
```

### **Required Files and Their Purposes**

#### **1. Main Configuration File**
**File:** `.cursor/rules.mdc`
**Purpose:** Central hub that imports all other rules
**Structure:**
```markdown
# Agentic Development Swarm - Main Rules

## Core Development Rules
@import ./rules/core/code-style.mdc
@import ./rules/core/general.mdc
@import ./rules/core/architecture.mdc

## Language-Specific Rules
@import ./rules/language/javascript.mdc

## Pattern-Specific Rules
@import ./rules/patterns/agent-communication.mdc
@import ./rules/patterns/error-handling.mdc
@import ./rules/patterns/task-routing.mdc

## Planning Rules
@import-if-plan ./rules/planning/plan-generic.mdc
@import-if-specs ./rules/planning/plan-specs.mdc

## Tool-Specific Rules
@import-if-git ./rules/tools/git.mdc
@import ./rules/tools/deployment.mdc
```

#### **2. Core Rules Directory**
**Purpose:** Fundamental project guidelines

**`core/code-style.mdc`** - Coding standards and conventions
**`core/general.mdc`** - General project principles
**`core/architecture.mdc`** - System architecture guidelines

#### **3. Language Rules Directory**
**Purpose:** Language-specific coding rules

**`language/javascript.mdc`** - JavaScript/Node.js specific rules

#### **4. Patterns Rules Directory**
**Purpose:** Architectural patterns and design principles

**`patterns/agent-communication.mdc`** - Inter-agent communication patterns
**`patterns/error-handling.mdc`** - Error handling strategies
**`patterns/task-routing.mdc`** - Task routing and orchestration patterns

#### **5. Planning Rules Directory**
**Purpose:** AI planning and specification handling

**`planning/plan-generic.mdc`** - General planning guidelines
**`planning/plan-specs.mdc`** - Specification handling rules

#### **6. Tools Rules Directory**
**Purpose:** Tool-specific configurations and workflows

**`tools/git.mdc`** - Git workflow and commit standards
**`tools/deployment.mdc`** - Deployment and DevOps guidelines

### **File Structure Template**

Each `.mdc` file should follow this exact structure:

```markdown
---
description: Brief description of the rule's purpose
globs: File patterns the rule applies to (e.g., **/*.js, **/*.ts)
priority: high|medium|low
---

# Rule Title

## Overview
Clear explanation of what this rule covers.

## Requirements
Specific requirements that must be followed.

## Examples

### ✅ Good Example
```javascript
// Example of correct implementation
```

### ❌ Bad Example
```javascript
// Example of what to avoid
```

## Implementation Notes
Additional context or considerations.
```

### **Key File Naming Rules**

1. **Extension:** Always use `.mdc` (not `.md`)
2. **Naming:** Use kebab-case (e.g., `code-style.mdc`, `agent-communication.mdc`)
3. **Descriptive:** Names should clearly indicate the rule's purpose
4. **Hierarchical:** Organize by category in subdirectories

### **Content Best Practices**

1. **Be Specific:** Include concrete examples, not just general guidelines
2. **Use Metadata:** Always include the YAML frontmatter with description, globs, and priority
3. **Include Examples:** Both positive and negative examples are crucial
4. **Keep Focused:** Each file should cover one specific aspect
5. **Be Deterministic:** Use precise, unambiguous language

### **Priority Levels**
- **high:** Critical rules that must always be followed
- **medium:** Important rules with some flexibility
- **low:** Guidelines and suggestions
