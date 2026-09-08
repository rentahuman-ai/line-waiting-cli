# RentAHuman Line Waiting

Book someone to wait in line from your terminal. **$20 USD/hour total**, including platform fees. No login, subscription, or API key. Pay once through hosted Stripe Checkout, then AI recruits a worker, reviews their work, and releases payment.

Available in **New York City, Vancouver, Los Angeles, San Francisco, and Toronto**. Other cities are available **by request** and are not charged automatically.

## Run

Requires Node.js 22 or newer (or Bun).

```sh
git clone https://github.com/rentahuman-ai/line-waiting-cli.git
cd line-waiting-cli
node bin/rentahuman-line.js book
```

No dependencies or build step. To install the command from this repository:

```sh
bun install -g github:rentahuman-ai/line-waiting-cli
rentahuman-line cities
rentahuman-line book
```

The CLI prompts for the city, venue, street address, start time, duration, contact details, and handoff instructions. It shows the exact quote before preparing checkout. Open the returned payment link and pay. Then run `rentahuman-line status` to check payment, worker confirmation, and the AI report.

## Non-interactive booking

Choose a date **at least 24 hours in the future**, within 30 days. Pay at least 24 hours before the scheduled start. Use the city's correct UTC offset on that date, or a UTC timestamp ending in `Z`. Invalid daylight-saving offsets are rejected.

```sh
rentahuman-line book \
  --city nyc --venue "Your venue" --address "The venue's full street address" \
  --start "2026-10-01T09:00-04:00" --hours 2 \
  --name "Alex" --email "alex@example.com" --phone "+12125551234" \
  --handoff "I will meet you at the entrance at 11am. Call me 15 minutes before." \
  --yes --json
```

Replace the example date and venue with your actual booking. Use `quote` instead of `book` to validate details and inspect pricing without creating an order. `--yes` prepares a payment link; it does not charge a card.

Duration is 1–12 hours in half-hour increments. A two-hour booking costs **$40 USD total**. Worker compensation is displayed separately in the API quote; the included platform fee is deducted from the total. No purchases, tickets, or extra hours are authorized.

## Other cities

```sh
rentahuman-line request --city Montreal
```

The CLI collects the same details and saves a request without payment. Contact **support@rentahuman.ai** with your order ID for review and arrangements. `book` also switches unsupported cities to this request flow.

## Private order files and retries

Each order gets a random private token, saved with its details under `~/.config/rentahuman-line/orders/` (or `$XDG_CONFIG_HOME/rentahuman-line/orders/`). Files are created with owner-only permissions. Keep them private: possession grants access to that order's status and report. Tokens cannot access other marketplace accounts or orders.

```sh
rentahuman-line status
rentahuman-line resume
rentahuman-line status --order /path/to/order.json
```

`resume` reuses the same immutable order and checkout, avoiding duplicate orders after a network failure. An expired checkout requires a new booking. An order file is never overwritten; use a new `--order` path for another order. Losing the file loses self-service access; contact support with your order ID.

Payment starts recruiting and does not guarantee a worker has accepted. The status command shows confirmed workers. If nobody is confirmed by the scheduled start, recruitment stops and unused funds return to the original payment method. Work and payment disputes may require support review. Payments completed too late are refunded rather than creating a last-minute booking. Refund timing depends on Stripe and your bank.

The venue must allow line holding and handoff. Customer contact details and handoff instructions are private to fulfillment, while the venue and task appear in a public worker bounty. Use `--notes` for additional private instructions. Do not include passwords, payment-card details, or identity documents.

## Development

```sh
node --test test/*.test.js
RENTAHUMAN_API_URL=http://localhost:3000 node bin/rentahuman-line.js cities
```

The client is MIT licensed. The hosted service is operated by RentAHuman; the server and its credentials are not part of this repository. The base URL is pinned in each saved order to prevent accidental credential forwarding when switching environments. Redirects are refused.
