import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, formatPhone } from "./format";

test("money is shown in dollars", () => {
  assert.equal(formatMoney(612.5), "$612.50");
  assert.equal(formatMoney(1000), "$1,000.00");
});

test("US phones are shown as (AAA) BBB-CCCC, others as stored", () => {
  for (const s of ["+14155550110", "4155550110", "1-415-555-0110"]) assert.equal(formatPhone(s), "(415) 555-0110", s);
  assert.equal(formatPhone("+447700900123"), "+447700900123");
  assert.equal(formatPhone("555-0150"), "555-0150");
  assert.equal(formatPhone(null), "");
});
