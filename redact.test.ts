import assert from 'node:assert/strict';
import test from 'node:test';
import { redact } from '../src/server/safety.ts';

test('redact removes provider API keys', () => {
  const output = redact('credential=sk_live_12345678901234567890');
  assert.doesNotMatch(output, /sk_live_12345678901234567890/);
  assert.match(output, /REDACTED/);
});

test('redact removes token and password assignments', () => {
  const output = redact('token: Bearer abcdefghijklmnopqrstuvwxyz password="open sesame"');
  assert.doesNotMatch(output, /abcdefghijklmnopqrstuvwxyz|open sesame/);
  assert.match(output, /REDACTED/);
});

test('redact removes authorization bearer values', () => {
  const output = redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.signature.payload');
  assert.doesNotMatch(output, /eyJhbGciOiJIUzI1NiJ9|signature\.payload/);
  assert.match(output, /REDACTED/);
});

test('redact removes email addresses and IPv4 addresses', () => {
  const output = redact('contact oncall@example.com from 10.24.7.19');
  assert.doesNotMatch(output, /oncall@example\.com|10\.24\.7\.19/);
  assert.match(output, /REDACTED_EMAIL/);
  assert.match(output, /REDACTED_IP/);
});

test('redact removes IPv6 addresses', () => {
  const output = redact('peer=2001:0db8:85a3:0000:0000:8a2e:0370:7334');
  assert.doesNotMatch(output, /2001:0db8:85a3/);
  assert.match(output, /REDACTED_IP/);
});
