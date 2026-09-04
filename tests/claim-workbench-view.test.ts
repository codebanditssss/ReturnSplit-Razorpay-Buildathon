import assert from "node:assert/strict";
import test from "node:test";

import { toClaimWorkbenchView } from "../src/lib/claim-workbench-view";
import { getClaimById, getOrderById, getPolicyById } from "../src/lib/data";

test("claim workbench payload excludes raw customer and provider identifiers", () => {
  const claim = getClaimById("RET-260903-031");
  const order = getOrderById("MM-18472");
  const policy = order ? getPolicyById(order.policyId) : undefined;
  assert.ok(claim?.decision && order && policy);

  const serialized = JSON.stringify(toClaimWorkbenchView(claim, order, policy, []));

  assert.doesNotMatch(serialized, new RegExp(claim.customer.email.replaceAll(".", "\\.")));
  assert.doesNotMatch(serialized, new RegExp(order.paymentId));
  for (const transfer of order.transfers) {
    assert.doesNotMatch(serialized, new RegExp(transfer.providerTransferId));
    assert.doesNotMatch(serialized, new RegExp(transfer.linkedAccountId));
  }
  assert.match(serialized, /\u2022\u2022\u2022\u2022/);
  assert.match(serialized, /Maya Rao/);
});
