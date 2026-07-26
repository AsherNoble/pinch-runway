import type { ActionClass, PermissionMode } from "./contracts.ts";

export type PermissionDecision = "denied" | "approval_required" | "execute";

export interface PermissionCheck {
  action_class: ActionClass;
  mode: PermissionMode;
  decision: PermissionDecision;
}

export class PermissionDeniedError extends Error {
  readonly action_class: ActionClass;

  constructor(actionClass: ActionClass) {
    super(`Action "${actionClass}" is blocked by the owner's permissions`);
    this.name = "PermissionDeniedError";
    this.action_class = actionClass;
  }
}

export class ApprovalRequiredError extends Error {
  readonly action_class: ActionClass;

  constructor(actionClass: ActionClass) {
    super(`Action "${actionClass}" requires owner approval`);
    this.name = "ApprovalRequiredError";
    this.action_class = actionClass;
  }
}

export function checkPermission(
  actionClass: ActionClass,
  mode: PermissionMode,
): PermissionCheck {
  const decision: PermissionDecision =
    mode === "blocked"
      ? "denied"
      : mode === "ask"
        ? "approval_required"
        : "execute";

  return {
    action_class: actionClass,
    mode,
    decision,
  };
}

/**
 * Tool wrappers call this immediately before a side effect. Prompt text can
 * never override the owner's persisted permission mode.
 */
export function enforcePermission(
  actionClass: ActionClass,
  mode: PermissionMode,
): void {
  const { decision } = checkPermission(actionClass, mode);

  if (decision === "denied") {
    throw new PermissionDeniedError(actionClass);
  }

  if (decision === "approval_required") {
    throw new ApprovalRequiredError(actionClass);
  }
}
