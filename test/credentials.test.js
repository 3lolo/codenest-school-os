import assert from "node:assert/strict";
import test from "node:test";
import { generatePassword } from "../api/_lib/password.js";

test("generated password meets length and complexity requirements", () => {
  for (let i = 0; i < 25; i += 1) {
    const password = generatePassword();
    assert.equal(password.length, 14);
    assert.match(password, /[a-z]/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[!@#$%*?-]/);
    assert.doesNotMatch(password, /[il1o0IOL]/);
  }
});

test("generated passwords are not repeated across calls", () => {
  const generated = new Set(Array.from({ length: 50 }, () => generatePassword()));
  assert.equal(generated.size, 50);
});

test("custom length is respected", () => {
  assert.equal(generatePassword(20).length, 20);
});
