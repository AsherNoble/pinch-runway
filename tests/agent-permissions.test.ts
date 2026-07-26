import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalRequiredError,
  checkPermission,
  enforcePermission,
  PermissionDeniedError,
} from "../lib/agent/permissions.ts";

test("blocked actions are denied at the tool boundary", () => {
  assert.deepEqual(checkPermission("payment_link", "blocked"), {
    action_class: "payment_link",
    mode: "blocked",
    decision: "denied",
  });
  assert.throws(
    () => enforcePermission("payment_link", "blocked"),
    PermissionDeniedError,
  );
});

test("ask actions require explicit approval", () => {
  assert.equal(
    checkPermission("collection_email", "ask").decision,
    "approval_required",
  );
  assert.throws(
    () => enforcePermission("collection_email", "ask"),
    ApprovalRequiredError,
  );
});

test("auto actions execute without an approval exception", () => {
  assert.equal(checkPermission("receipt_request", "auto").decision, "execute");
  assert.doesNotThrow(() => enforcePermission("receipt_request", "auto"));
});
