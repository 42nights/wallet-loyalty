import { test } from "node:test";
import assert from "node:assert/strict";
import { merchantFields } from "./merchant";

// The creator admin must not accept an earn rate owner Settings would refuse
// (it once allowed up to 1000 against Settings' 100).
test("admin earn rate uses the Settings range, 0.1 to 100", () => {
  for (const earnRate of [0.1, 1, 100, "12.5"])
    assert.equal(typeof merchantFields({ earnRate }, true), "object", String(earnRate));
  for (const earnRate of [100.01, 1000, 0.09, 0, -5, "", "abc", null, NaN, Infinity])
    assert.match(String(merchantFields({ earnRate }, true)), /between 0\.1 and 100/, String(earnRate));
});
