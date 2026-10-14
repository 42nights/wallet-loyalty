import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, validateEnroll } from "./validate";

test("format variants of one phone number normalise to the same value", () => {
  for (const raw of ["555-016856", "555 016856", "(555) 016.856", " 555016856 "])
    assert.equal(normalizePhone(raw), "555016856");
  assert.equal(normalizePhone("+1 (555) 010-0123"), "+15550100123");
});

test("phone numbers outside 7-15 digits or with stray characters are rejected", () => {
  for (const raw of ["123456", "1234567890123456", "555-CALL-NOW", "1+5550100", "++15550100", "#5550100"])
    assert.equal(normalizePhone(raw), null, raw);
});

test("name and phone are required, email is optional but checked", () => {
  const empty = validateEnroll({});
  assert.equal(empty.ok, false);
  assert.deepEqual(Object.keys(!empty.ok ? empty.errors : {}).sort(), ["name", "phone"]);

  const bad = validateEnroll({ name: "x".repeat(61), phone: "12", email: "not-an-email" });
  assert.deepEqual(Object.keys(!bad.ok ? bad.errors : {}).sort(), ["email", "name", "phone"]);

  assert.deepEqual(validateEnroll({ name: "  Ada \n Lovelace ", phone: "555 016856", email: "  " }), {
    ok: true,
    value: { name: "Ada Lovelace", phone: "555016856", email: null },
  });
  assert.equal(validateEnroll({ name: "Ada", phone: "5550100", email: "ada@example.com" }).ok, true);
});
