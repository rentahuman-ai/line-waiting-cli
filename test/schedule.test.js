import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cityTimezone, formatLocalTime, localStart } from '../src/schedule.js';

test('uses each destination timezone in summer and winter', () => {
  for (const [timezone, summer, winter] of [
    ['America/New_York', 13, 14],
    ['America/Toronto', 13, 14],
    ['America/Vancouver', 16, 17],
    ['America/Los_Angeles', 16, 17],
  ]) {
    assert.equal(
      localStart('2026-07-10', '9am', timezone),
      `2026-07-10T${summer}:00:00Z`
    );
    assert.equal(
      localStart('2026-01-10', '9am', timezone),
      `2026-01-10T${winter}:00:00Z`
    );
  }
});

test('supports 12-hour and 24-hour times, including noon and midnight', () => {
  for (const [time, hour, minute] of [
    ['12am', '04', '00'],
    ['12pm', '16', '00'],
    ['2:30 PM', '18', '30'],
    ['14:30', '18', '30'],
  ]) {
    assert.equal(
      localStart('2026-07-10', time, 'America/New_York'),
      `2026-07-10T${hour}:${minute}:00Z`
    );
  }
});

test('relative dates use the destination calendar across midnight and month end', () => {
  const now = new Date('2026-08-01T02:00:00Z'); // Still July 31 in Vancouver.
  assert.equal(
    localStart('today', '9am', 'America/Vancouver', now),
    '2026-07-31T16:00:00Z'
  );
  assert.equal(
    localStart('tomorrow', '9am', 'America/Vancouver', now),
    '2026-08-01T16:00:00Z'
  );
});

test('rejects impossible dates, malformed times, and daylight-saving gaps or overlaps', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '10/01/2026'])
    assert.throws(
      () => localStart(date, '9am', 'America/New_York'),
      /valid date/
    );
  for (const time of ['25:00', '13pm', '0am', '9:60', '9:3', '-1', 'later'])
    assert.throws(
      () => localStart('2026-07-10', time, 'America/New_York'),
      /time/
    );
  assert.throws(
    () => localStart('2026-03-08', '2:30am', 'America/New_York'),
    /does not exist/
  );
  assert.throws(
    () => localStart('2026-11-01', '1:30am', 'America/New_York'),
    /occurs twice/
  );
  assert.equal(
    localStart('2026-11-01', '2:30am', 'America/New_York'),
    '2026-11-01T07:30:00Z'
  );
});

test('resolves city aliases against the service catalog and formats a readable confirmation', () => {
  const cities = [
    { id: 'nyc', name: 'New York', timezone: 'America/New_York' },
    {
      id: 'san-francisco',
      name: 'San Francisco',
      timezone: 'America/Los_Angeles',
    },
  ];
  assert.equal(cityTimezone('New York City', cities), 'America/New_York');
  assert.equal(cityTimezone(' Manhattan ', cities), 'America/New_York');
  assert.equal(cityTimezone('SF', cities), 'America/Los_Angeles');
  assert.equal(cityTimezone('Montreal', cities), undefined);
  assert.match(
    formatLocalTime('2026-07-10T13:00:00Z', 'America/New_York'),
    /Friday, July 10, 2026.*9:00 AM.*EDT/
  );
});
