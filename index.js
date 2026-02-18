/**
 * ShipMachine ShipMachine
 * An engineering-only shipping agent. Every LLM call is mediated by PromptOS.
 * Pure: Objective → Plan → Code → PR.
 */

import { ShipMachine } from './orchestrator/index.js';
import { PolicyEngine } from './control-plane/policy.js';
import { RBAC } from './control-plane/rbac.js';
import { PromptOSBridge } from './promptos-bridge/index.js';
import { FilesystemTool } from './tools/fs.js';
import { GitTool } from './tools/git.js';
import { ExecTool } from './tools/exec.js';
import { TestsTool } from './tools/tests.js';
import { PRTool } from './tools/pr.js';
import { TaskContext } from './memory/task-context.js';

// Re-export for external use
export {
  ShipMachine,
  PolicyEngine,
  RBAC,
  PromptOSBridge,
  FilesystemTool,
  GitTool,
  ExecTool,
  TestsTool,
  PRTool,
  TaskContext,
};

// Auto-register CLI if run directly
const isMain = process.argv[1]?.includes('cli');
if (isMain) {
  // CLI is self-registering via commander
  // This file is also the main entry point for programmatic use
}

export default {
  ShipMachine,
  PolicyEngine,
  RBAC,
  PromptOSBridge,
  FilesystemTool,
  GitTool,
  ExecTool,
  TestsTool,
  PRTool,
  TaskContext,
};
