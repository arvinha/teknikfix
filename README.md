# TeknikFix Aalborg

Website and booking desk for TeknikFix, a trading name of Axiom, CVR 46840992, Saltumvej 195, 9220 Aalborg Øst.

## Run on this PC

Double-click `start.bat`. Customers: http://localhost:4321. Cases: http://localhost:4321/admin (password is `ADMIN_PASSWORD` in `.env`).

## Put it online at teknikfix.dk

1. `teknikfix.dk` is bought at Simply.com (invoice 4896285). Confirm it with MitID in the email from Punktum dk so it becomes active.
2. Create a free Cloudflare account, add `teknikfix.dk` on the free plan, and set the two Cloudflare nameservers in the Simply.com control panel.
3. Double-click `GO-ONLINE.bat`. Log in to Cloudflare in the browser that opens and pick `teknikfix.dk`.

The script creates a Cloudflare tunnel from this PC to `teknikfix.dk` and `www.teknikfix.dk`, adds `run-online.bat` to Windows startup, and turns off sleep while the PC is plugged in. The PC must stay on for the site to be online.

## Google

The site has Danish titles and descriptions, local business data (address, coordinates, 24-hour opening, services), four search pages for common repairs, a sitemap at `/sitemap.xml`, and a share image.

After the domain is live:

1. Register TeknikFix as a binavn for Axiom on virk.dk.
2. Create the Google Business Profile at business.google.com with the name, address, phone and 24-hour hours shown on the site. Verify it the way Google asks.
3. Add `teknikfix.dk` as a domain property in Google Search Console, verify with the TXT record in Cloudflare DNS, and submit `https://teknikfix.dk/sitemap.xml`.

The same checklist is on the admin page after you log in. If Search Console gives you an HTML tag instead, paste only the content value into `googleSiteVerification` in `site.config.json` and restart.

## Prices

Customers pick their model and one or more repairs when they book, and see each price, the total and the time before they send. The admin page lists every repair in the case. Prices come from `prices.json`: each model has a market price (what Aalborg shops charge), and the site sets your price a set percent below it, ending in 49 or 99. Change the percent, set your own price, or update market prices on the admin page under "Priser og konkurrens". The same prices show on `/priser` and the search pages.

## Card, MobilePay and Klarna

These run through Stripe. Create an account at stripe.com, turn on the payment methods under Settings → Payment methods, and put the secret key in `.env` as `STRIPE_SECRET_KEY`. Add a webhook to `https://teknikfix.dk/api/stripe/webhook` with the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and put its signing secret in `.env` as `STRIPE_WEBHOOK_SECRET`. Restart. Until the key is there, the site only offers PayPal and bank.

## Notifications on your phone

When a customer books, pays by card, approves a price or reports a PayPal/bank payment, your phone gets a push notification with buttons to call the customer or open the case. It uses the free app ntfy (App Store / Google Play): tap + and subscribe to the topic in `.env` as `NTFY_TOPIC`. Keep the topic secret, since anyone who knows it can read the messages. Restart after changes.

## Mail and SMS to the customer

The customer gets a confirmation by mail and SMS when they book, and a message when you set the case to Tid bekræftet, Tilbud sendt, I gang, Klar til betaling, Betalt, Afsluttet, Kunne ikke or Aflyst. On the admin page you can add a "Besked til kunden" (for example the exact time), and untick "Send til kunden" to stay quiet. Each message has a link to the case.

- Mail: create a free account at resend.com, add the domain teknikfix.dk (the DNS records go in Cloudflare), create an API key and put it in `.env` as `RESEND_API_KEY`, with `MAIL_FROM=TeknikFix <booking@teknikfix.dk>`. Replies go to the email in `site.config.json`.
- SMS: create an account at gatewayapi.com, add credit, create an API token and put it in `.env` as `GATEWAYAPI_TOKEN`.

Restart after changes. Without the keys, nothing is sent and the customer only sees updates on their case page.

## Change details

Phone, email, PayPal and bank details are in `site.config.json`. Restart after changes.
