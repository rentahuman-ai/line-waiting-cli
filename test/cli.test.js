import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  apiBase,
  collectInput,
  loadOrder,
  saveOrder,
  terminalText,
} from '../src/cli.js';

const cities = [{ id: 'nyc', name: 'New York', timezone: 'America/New_York' }];

test('accepts production HTTPS and local HTTP, rejects unsafe bases', () => {
  assert.equal(apiBase(), 'https://rentahuman.ai');
  assert.equal(apiBase('http://localhost:3000'), 'http://localhost:3000');
  for (const value of [
    'http://example.com',
    'https://user:secret@example.com',
    'https://example.com/path',
    'https://example.com?token=a',
  ])
    assert.throws(() => apiBase(value));
});

test('saves private credentials before networking and never overwrites another order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'renta-line-test-'));
  try {
    const path = join(directory, 'order.json');
    const order = {
      base: 'https://rentahuman.ai',
      token: 'a'.repeat(64),
      input: { city: 'nyc' },
      action: 'checkout',
    };
    await saveOrder(path, order);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await loadOrder(path), order);
    await assert.rejects(saveOrder(path, { token: 'b'.repeat(64) }), {
      code: 'EEXIST',
    });
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), order);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('strips terminal escape controls from service and user text', () => {
  assert.equal(terminalText('venue\u001b[31m\nnext'), 'venue [31m next');
});

test('recovers a failed checkout using the saved capability and original server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'renta-line-resume-'));
  const path = join(directory, 'order.json');
  const calls = [];
  let attempts = 0;
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ success: true, cities }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    calls.push({ body, authorization: request.headers.authorization });
    response.setHeader('Content-Type', 'application/json');
    if (body.action === 'quote') {
      response.end(
        JSON.stringify({
          success: true,
          available: true,
          quote: { totalCents: 4000 },
          paymentDeadline: '2026-10-01T01:00Z',
          message: 'Pay to start recruitment.',
        })
      );
    } else if (++attempts === 1) {
      response.statusCode = 503;
      response.end(
        JSON.stringify({
          success: false,
          error: 'Temporary checkout interruption.',
        })
      );
    } else {
      response.end(
        JSON.stringify({
          success: true,
          orderId: 'test-order',
          status: 'checkout',
          checkoutUrl: 'https://checkout.stripe.com/test',
        })
      );
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const bin = fileURLToPath(
      new URL('../bin/rentahuman-line.js', import.meta.url)
    );
    const run = promisify(execFile);
    const options = {
      env: { ...process.env, TZ: 'Asia/Tokyo', RENTAHUMAN_API_URL: base },
    };
    await assert.rejects(
      run(
        process.execPath,
        [
          bin,
          'book',
          '--city',
          'nyc',
          '--venue',
          'Venue',
          '--address',
          '123 Main Street',
          '--date',
          '2026-10-01',
          '--time',
          '9am',
          '--hours',
          '2',
          '--name',
          'Guest',
          '--email',
          'guest@example.com',
          '--phone',
          '+12125551234',
          '--handoff',
          'Meet at the entrance.',
          '--yes',
          '--json',
          '--order',
          path,
        ],
        options
      ),
      /Temporary checkout interruption/
    );
    const saved = await loadOrder(path);
    assert.equal(saved.input.startsAt, '2026-10-01T13:00:00Z');
    assert.equal(saved.base, base);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const resumed = await run(
      process.execPath,
      [bin, 'resume', '--json', '--order', path],
      {
        env: {
          ...process.env,
          RENTAHUMAN_API_URL: 'https://unused.example.com',
        },
      }
    );
    assert.equal(
      JSON.parse(resumed.stdout).checkoutUrl,
      'https://checkout.stripe.com/test'
    );
    assert.equal(calls.length, 3);
    assert.equal(calls[1].authorization, `Bearer ${saved.token}`);
    assert.equal(calls[2].authorization, calls[1].authorization);
    assert.deepEqual(calls[2].body, calls[1].body);
    assert.ok(!resumed.stdout.includes(saved.token));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('prompts for local date and time without asking for an offset', async () => {
  const labels = [];
  const answers = [
    'NYC',
    'Venue',
    '123 Main Street',
    '2026-10-01',
    '2:30pm',
    '2',
    'Guest',
    'guest@example.com',
    '+12125551234',
    'Meet at entrance',
  ];
  const result = await collectInput(
    {},
    {
      question: async (label) => {
        labels.push(label);
        return answers.shift();
      },
    },
    cities
  );
  assert.equal(result.input.startsAt, '2026-10-01T18:30:00Z');
  assert.equal(result.timezone, 'America/New_York');
  assert.match(labels[3], /Date in NYC/);
  assert.match(labels[3], /at least 12 hours ahead/);
  assert.match(labels[4], /Local start time in NYC/);
  assert.ok(labels.every((label) => !/UTC|offset|Timezone/.test(label)));
});

test('accepts local --start, preserves legacy timestamps, and requires a zone for other cities', async () => {
  const flags = {
    city: 'nyc',
    venue: 'Venue',
    address: '123 Main Street',
    hours: '2',
    name: 'Guest',
    email: 'guest@example.com',
    phone: '+12125551234',
    handoff: 'Meet at entrance',
  };
  for (const start of [
    '2026-10-01 9am',
    '2026-10-01T09:00',
    'Thursday October 1st, 2026 9am',
  ]) {
    assert.equal(
      (await collectInput({ ...flags, start }, null, cities)).input.startsAt,
      '2026-10-01T13:00:00Z'
    );
  }
  for (const start of ['2026-10-01T09:00-04:00', '2026-10-01T13:00Z']) {
    assert.equal(
      (await collectInput({ ...flags, start }, null, cities)).input.startsAt,
      start
    );
  }
  await assert.rejects(
    collectInput(
      { ...flags, start: '2026-10-01 9am', date: '2026-10-02' },
      null,
      cities
    ),
    /either --start/
  );
  await assert.rejects(
    collectInput(
      {
        ...flags,
        date: '2026-10-01',
        time: '9am',
        timezone: 'America/Los_Angeles',
      },
      null,
      cities
    ),
    /omit --timezone/
  );
  const other = { ...flags, city: 'Montreal', date: '2026-10-01', time: '9am' };
  await assert.rejects(
    collectInput(other, null, cities),
    /--timezone is required/
  );
  await assert.rejects(
    collectInput({ ...other, timezone: 'Moon/Base' }, null, cities),
    /Unknown timezone/
  );
  assert.equal(
    (
      await collectInput(
        { ...other, timezone: 'America/Montreal' },
        null,
        cities
      )
    ).input.startsAt,
    '2026-10-01T13:00:00Z'
  );
});

test('lets an interactive user correct a written date without re-entering the venue', async (t) => {
  const labels = [];
  const answers = [
    'Sunday Sep 12th, 2026',
    '1:00pm',
    'Saturday Sep 12th, 2026',
    '1:00pm',
  ];
  const errors = [];
  t.mock.method(process.stderr, 'write', (value) => {
    errors.push(value);
    return true;
  });
  const result = await collectInput(
    {
      city: 'NYC',
      venue: 'Katz Delicatessen',
      address: '205 E Houston St, New York, NY 10002',
      hours: '2',
      name: 'Guest',
      email: 'guest@example.com',
      phone: '+12125551234',
      handoff: 'Meet at the entrance.',
    },
    {
      question: async (label) => {
        labels.push(label);
        return answers.shift();
      },
    },
    cities
  );
  assert.equal(result.input.startsAt, '2026-09-12T17:00:00Z');
  assert.equal(result.input.venue, 'Katz Delicatessen');
  assert.equal(labels.length, 4);
  assert.ok(
    labels.every((label) => /Date in NYC|Local start time in NYC/.test(label))
  );
  assert.match(errors.join(''), /weekday does not match/);
});
