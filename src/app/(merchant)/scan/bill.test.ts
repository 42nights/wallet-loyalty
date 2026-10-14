import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBill } from "./bill";

// A wrong parse here credits the wrong number of points at the counter.

test("reads dot and comma decimals as the same amount", () => {
  assert.equal(parseBill("12.50"), 12.5);
  assert.equal(parseBill("12,50"), 12.5);
  assert.equal(parseBill(" 12,5 "), 12.5);
  assert.equal(parseBill("40"), 40);
  assert.equal(parseBill("12."), 12);
  assert.equal(parseBill(".5"), 0.5);
});

test("rejects anything that isn't a plain positive amount", () => {
  for (const bad of ["", ".", "abc", "-5", "0", "0,00", "12.505", "1,250.00", "1 250", "$12", "12a", "1e3"])
    assert.equal(parseBill(bad), null, bad);
});
