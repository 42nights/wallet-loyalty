import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, validateEnroll } from "./validate";

test("format variants of one phone number normalise to the same value", () => {
  for (const raw of ["555-016856", "555 016856", "(555) 016.856", " 555016856 "])
    assert.equal(normalizePhone(raw), "555016856");
  assert.equal(normalizePhone("+1 (555) 010-0123"), "+15550100123");
});

// F1: the leading 1 / +1 forms used to be stored apart from the bare 10 digits,
// so the unique index let the same customer enrol twice.
test("a US number typed with or without the country code is one E.164 value", () => {
  for (const raw of ["(415) 555-0110", "415 555 0110", "1-415-555-0110", "+1 415.555.0110", "001 415 555 0110"])
    assert.equal(normalizePhone(raw), "+14155550110", raw);
});

test("non-US numbers stay as typed, with 00 read as +", () => {
  assert.equal(normalizePhone("+44 7700 900123"), "+447700900123");
  assert.equal(normalizePhone("0044 7700 900123"), "+447700900123");
  assert.equal(normalizePhone("+49 30 123456"), "+4930123456");
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
    value: { name: "Ada Lovelace", phone: "555016856", email: null, birthday: null },
  });
  assert.equal(validateEnroll({ name: "Ada", phone: "5550100", email: "ada@example.com" }).ok, true);
});

test("names: control characters stripped, invisible-only rejected, ZWNJ kept", () => {
  const ok = validateEnroll({ name: "Ann\u0000a\u200B", phone: "5550101234" });
  assert.ok(ok.ok && ok.value.name === "Ann a");
  const invisible = validateEnroll({ name: "\u200B\u200C\uFEFF", phone: "5550101234" });
  assert.ok(!invisible.ok && invisible.errors.name);
  const persian = validateEnroll({ name: "\u0645\u06cc\u200c\u0631\u0648\u062f", phone: "5550101234" });
  assert.ok(persian.ok && persian.value.name.includes("\u200c"));
});

test("birthday is an optional month and day, kept on the placeholder year 2000", () => {
  const stored = (birthday: string) => {
    const r = validateEnroll({ name: "Ada", phone: "5550101234", birthday });
    return r.ok ? r.value.birthday : `error: ${r.errors.birthday}`;
  };
  assert.equal(stored(""), null);
  assert.equal(stored("03-14"), "2000-03-14");
  assert.equal(stored("02-29"), "2000-02-29");
  for (const bad of ["02-30", "13-01", "00-10", "04-31", "3-14", "03-", "-14", "2000-03-14"])
    assert.match(String(stored(bad)), /^error: /, bad);
});
