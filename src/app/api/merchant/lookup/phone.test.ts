import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_PHONE_DIGITS, digitsOf, maskPhone, phoneMatches, phoneSuffixPattern } from "./phone";

// A false match here loads the wrong customer at the counter, and points get
// credited/redeemed on someone else's card.

test("matches across formatting, country code and last-4", () => {
  // canonical "+1…" (enrolled now) and the legacy forms older cards still hold
  const stored = ["+15550101234", "+1 555-010-1234", "5550101234", "15550101234", "(555) 010-1234"];
  const typed = ["555 010 1234", "555-010-1234", "+1 (555) 010-1234", "1-555-010-1234", "1234", "0101234"];
  for (const s of stored)
    for (const t of typed) assert.ok(phoneMatches(s, digitsOf(t)), `${s} ← ${t}`);
});

test("rejects different numbers and junk short phones", () => {
  assert.equal(phoneMatches("+1 555-010-1234", digitsOf("555-010-1235")), false);
  assert.equal(phoneMatches("+1 555-010-1234", digitsOf("1555")), false);
  assert.equal(phoneMatches("1234", digitsOf("555-010-1234")), false);
  assert.equal(phoneMatches(null, "1234"), false);
  assert.equal(phoneMatches("n/a", "1234"), false);
});

test("db pre-filter pattern is digits + \\D* only, anchored at the end", () => {
  assert.equal(phoneSuffixPattern("5550101234"), "1\\D*2\\D*3\\D*4\\D*$");
  const re = new RegExp(phoneSuffixPattern("1234"));
  assert.ok(re.test("+1 555-010-12 34"));
  assert.ok(!re.test("+1 555-010-1243"));
});

test("lookups need a full local number, never just the last 4", () => {
  assert.ok(MIN_PHONE_DIGITS >= 7);
  assert.ok(digitsOf("1234").length < MIN_PHONE_DIGITS);
  assert.ok(digitsOf("555-0101").length >= MIN_PHONE_DIGITS);
});

test("masked phone shows only the last 4 digits", () => {
  assert.equal(maskPhone("+1 555-010-1234"), "••• 1234");
});
