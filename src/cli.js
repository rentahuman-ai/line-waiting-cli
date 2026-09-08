import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

export const HELP = `RentAHuman Line Waiting

Commands:
  rentahuman-line cities          Show supported cities and prices
  rentahuman-line quote [flags]   Review a quote without creating an order
  rentahuman-line book [flags]    Prepare an order and get a payment link
  rentahuman-line request [flags] Request another city; no payment
  rentahuman-line status          Check your latest saved order
  rentahuman-line resume          Retry an interrupted checkout safely

Booking flags (missing values are prompted in an interactive terminal):
  --city NYC --venue "Venue name" --address "Full street address"
  --start "2026-10-01T09:00-04:00" --hours 2
  --name "Your name" --email "you@example.com" --phone "+12125551234"
  --handoff "Where and how you will take over" --notes "Optional details"
  --yes                         Confirm the displayed order non-interactively
  --json                        Machine-readable response
  --order /path/to/order.json    Save to or load this private order file

$20 USD/hour total, fees included. Book and pay at least 24 hours ahead.
1–12 hours, in 30-minute increments; dates up to 30 days ahead.
NYC, Vancouver, Los Angeles, San Francisco, Toronto. Other cities by request.
No login or subscription. Pay once in hosted checkout. No extra hours or
purchases are authorized. Payment starts recruitment; a worker must confirm.
Keep your private order file to check status and resume without logging in.
`;

export function apiBase(value = 'https://rentahuman.ai') {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
  ) {
    throw new Error(
      'RENTAHUMAN_API_URL must be an HTTPS origin, or HTTP localhost for development.'
    );
  }
  return url.origin;
}

export function terminalText(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

async function api(base, path, token, body) {
  const response = await fetch(`${base}/api/line-waiting${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Service returned HTTP ${response.status}. Retry with resume if an order was saved.`
    );
  }
  if (!response.ok || !data.success)
    throw new Error(data.error ?? `Service returned HTTP ${response.status}.`);
  return data;
}

function ordersDirectory() {
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'rentahuman-line',
    'orders'
  );
}

async function latestOrder() {
  let names;
  try {
    names = await readdir(ordersDirectory());
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error('No saved orders. Run rentahuman-line book.');
    throw error;
  }
  const name = names
    .filter((name) => /^\d{13}-[a-f0-9-]+\.json$/.test(name))
    .sort()
    .at(-1);
  if (!name)
    throw new Error(
      'No saved orders. Use --order to load a custom order file.'
    );
  return join(ordersDirectory(), name);
}

export async function saveOrder(path, order) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Exclusive creation prevents overwriting another order or following a symlink.
  await writeFile(path, `${JSON.stringify(order, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
}

export async function loadOrder(path) {
  const order = JSON.parse(await readFile(path, 'utf8'));
  if (
    !order ||
    typeof order !== 'object' ||
    typeof order.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(order.token) ||
    !order.input ||
    !['checkout', 'request'].includes(order.action)
  ) {
    throw new Error('Invalid private order file.');
  }
  return { ...order, base: apiBase(order.base) };
}

async function collectInput(flags, prompt) {
  const fields = [
    [
      'city',
      'City (NYC, Vancouver, Los Angeles, San Francisco, Toronto, or another city)',
    ],
    ['venue', 'Venue name'],
    ['address', 'Full street address'],
    [
      'start',
      'Start time with local UTC offset (YYYY-MM-DDTHH:mm-04:00, for example)',
    ],
    ['hours', 'How many hours (1–12, half-hour increments)'],
    ['name', 'Your name'],
    ['email', 'Contact email'],
    ['phone', 'Phone with country code (+1...)'],
    ['handoff', 'How and where will you take the worker’s place?'],
  ];
  const values = {};
  for (const [key, label] of fields) {
    const value =
      flags[key] ?? (prompt ? await prompt.question(`${label}: `) : '');
    if (typeof value !== 'string' || !value.trim())
      throw new Error(`--${key} is required in non-interactive mode.`);
    values[key] = value.trim();
  }
  return {
    city: values.city,
    venue: values.venue,
    address: values.address,
    startsAt: values.start,
    hours: Number(values.hours),
    name: values.name,
    email: values.email,
    phone: values.phone,
    handoff: values.handoff,
    notes: flags.notes?.trim() ?? '',
  };
}

function printResult(data, json, path) {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ...data, ...(path ? { orderFile: path } : {}) })}\n`
    );
    return;
  }
  if (data.orderId)
    process.stdout.write(
      `Order: ${terminalText(data.orderId)}\nStatus: ${terminalText(data.status)}\n`
    );
  if (data.address)
    process.stdout.write(`Venue address: ${terminalText(data.address)}\n`);
  if (data.message) process.stdout.write(`${terminalText(data.message)}\n`);
  if (data.checkoutUrl)
    process.stdout.write(`\nPay once: ${terminalText(data.checkoutUrl)}\n`);
  if (data.run)
    process.stdout.write(
      `AI run: ${terminalText(data.run.status)}; confirmed workers: ${data.run.acceptedWorkerCount}\n${terminalText(data.run.report?.summary ?? '')}\n`
    );
  if (data.refundCents > 0)
    process.stdout.write(
      `Refund: $${(data.refundCents / 100).toFixed(2)} USD (${terminalText(data.status)})\n`
    );
  if (path)
    process.stdout.write(
      `Private order file: ${terminalText(path)}\nCheck progress: rentahuman-line status --order "${terminalText(path)}"\n`
    );
}

export async function main(args = process.argv.slice(2)) {
  const { values: flags, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      yes: { type: 'boolean' },
      json: { type: 'boolean' },
      city: { type: 'string' },
      venue: { type: 'string' },
      address: { type: 'string' },
      start: { type: 'string' },
      hours: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      handoff: { type: 'string' },
      notes: { type: 'string' },
      order: { type: 'string' },
    },
  });
  const command = positionals[0] ?? 'book';
  if (flags.help || command === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (
    positionals.length > 1 ||
    !['cities', 'quote', 'book', 'request', 'status', 'resume'].includes(
      command
    )
  )
    throw new Error('Unknown command. Run rentahuman-line --help.');
  if (command === 'status' || command === 'resume') {
    const path = flags.order ? resolve(flags.order) : await latestOrder();
    const order = await loadOrder(path);
    const { createHash } = await import('node:crypto');
    const id = createHash('sha256')
      .update(`line-waiting:${order.token}`)
      .digest('hex');
    const data =
      command === 'resume'
        ? await api(order.base, '', order.token, {
            action: order.action,
            input: order.input,
          })
        : await api(order.base, `/${id}`, order.token);
    printResult(data, flags.json, path);
    return;
  }
  const base = apiBase(process.env.RENTAHUMAN_API_URL);
  if (command === 'cities') {
    const data = await api(base, '');
    if (flags.json) printResult(data, true);
    else {
      process.stdout.write(
        '$20 USD/hour total, fees included. Pay at least 24 hours ahead.\n'
      );
      for (const city of data.cities)
        process.stdout.write(
          `${terminalText(city.name)} (${terminalText(city.id)}), ${terminalText(city.timezone)}\n`
        );
      process.stdout.write('Other cities: rentahuman-line request\n');
    }
    return;
  }
  const prompt =
    process.stdin.isTTY && !flags.json
      ? createInterface({ input: process.stdin, output: process.stderr })
      : null;
  try {
    const input = await collectInput(flags, prompt);
    const token = randomBytes(32).toString('hex');
    const quote = await api(base, '', token, { action: 'quote', input });
    if (command === 'quote') {
      printResult(quote, flags.json);
      if (!flags.json)
        process.stdout.write(
          `Total: $${(quote.quote.totalCents / 100).toFixed(2)} USD\n`
        );
      return;
    }
    const requestOnly = command === 'request' || !quote.available;
    process.stderr.write(
      `\n${terminalText(input.venue)}, ${terminalText(input.address)}, ${terminalText(input.city)}\n${terminalText(input.startsAt)} for ${input.hours} hours\n${requestOnly ? 'City request only. No checkout or charge.' : `Total: $${(quote.quote.totalCents / 100).toFixed(2)} USD, fees included. Pay by ${quote.paymentDeadline}.`}\n${terminalText(quote.message)}\n`
    );
    if (!flags.yes) {
      if (!prompt)
        throw new Error(
          'Review with quote, then pass --yes to prepare the order. Payment is completed separately in hosted checkout.'
        );
      if (
        (await prompt.question('Prepare this order? [y/N] '))
          .trim()
          .toLowerCase() !== 'y'
      )
        return;
    }
    const path = flags.order
      ? resolve(flags.order)
      : join(ordersDirectory(), `${Date.now()}-${randomUUID()}.json`);
    const action = requestOnly ? 'request' : 'checkout';
    await saveOrder(path, { version: 1, base, token, input, action });
    process.stderr.write(
      `Saved private order to ${terminalText(path)}. If interrupted, use rentahuman-line resume --order "${terminalText(path)}".\n`
    );
    printResult(
      await api(base, '', token, { action, input }),
      flags.json,
      path
    );
  } finally {
    prompt?.close();
  }
}
