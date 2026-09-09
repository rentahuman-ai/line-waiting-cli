const CITY_ALIASES = {
  'new york city': 'nyc',
  brooklyn: 'nyc',
  queens: 'nyc',
  bronx: 'nyc',
  manhattan: 'nyc',
  'staten island': 'nyc',
  la: 'los-angeles',
  sf: 'san-francisco',
};

export function cityTimezone(value, cities) {
  const name = value.trim().toLowerCase();
  return cities.find(
    (city) =>
      city.id === name ||
      city.name.toLowerCase() === name ||
      city.id === CITY_ALIASES[name]
  )?.timezone;
}

export function formatLocalTime(value, timezone = 'UTC') {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
}

export function hasExplicitOffset(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value
  );
}

export function localStart(dateText, timeText, timezone, now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const wallTime = (value) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(value).map(({ type, value }) => [type, value])
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  let date = dateText.trim().toLowerCase();
  if (date === 'today' || date === 'tomorrow') {
    const today = new Date(`${wallTime(now).slice(0, 10)}T00:00:00Z`);
    if (date === 'tomorrow') today.setUTCDate(today.getUTCDate() + 1);
    date = today.toISOString().slice(0, 10);
  }
  const time = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(timeText.trim());
  if (!time) throw new Error('Enter a time like 9am, 2:30pm, or 14:30.');
  let hour = Number(time[1]);
  const minute = Number(time[2] ?? 0);
  const period = time[3]?.toLowerCase();
  if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 23))
    throw new Error('Enter a valid time like 9am, 2:30pm, or 14:30.');
  if (period) hour = (hour % 12) + (period === 'pm' ? 12 : 0);
  const local = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const nominal = Date.parse(`${local}:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(nominal) ||
    new Date(nominal).toISOString().slice(0, 16) !== local
  )
    throw new Error('Enter a valid date as YYYY-MM-DD, today, or tomorrow.');

  // Sample both sides of a clock change, then require an exact local-time match.
  // Never let the computer's timezone or Date's DST normalization pick the booking.
  const offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = nominal + hours * 3_600_000;
    offsets.add(Date.parse(`${wallTime(sample)}:00Z`) - sample);
  }
  const matches = [...offsets]
    .map((offset) => nominal - offset)
    .filter((instant) => wallTime(instant) === local)
    .sort((a, b) => a - b);
  if (!matches.length)
    throw new Error(
      'That local time does not exist because the clocks move forward. Choose a time before or after the clock change.'
    );
  if (matches.length > 1)
    throw new Error(
      'That local time occurs twice because the clocks move back. Choose a time after the clock change, or use --start with an explicit UTC offset.'
    );
  return new Date(matches[0]).toISOString().replace('.000Z', 'Z');
}
