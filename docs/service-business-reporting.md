# Service business reporting

Deploy both Nucleas and the Dwight's Gutters site changes. In the company's Connections, save an owner admin session, then click **Connect service data**. No additional environment variables are required. This is opt-in for each company, not inferred from its domain.

The site exposes authenticated GET `/api/admin/nucleas/service-metrics`. Its existing owner authorization applies. Nucleas uses the saved company session server-side with public-IP DNS validation, pinned HTTPS, no redirects, a bounded response, and a deadline. It stores only the validated aggregate report.

- Leads: first known normalized email across inquiries and customer records. The site's forms require email. This is acquisition, not a count of open sales opportunities.
- Bookings: appointments created, excluding cancelled appointments. Repeat appointments count separately.
- New customers: first completed service for a customer ID, across all booking history. Payment method is irrelevant.
- Total customers: distinct customers with completed bookings, including legacy completions missing timestamps. Such missing timestamps cannot contribute to daily acquisition.
- Counts use the site's timezone. The panel excludes the partial current day from the seven-day totals.

Successful setup enables hourly refresh through the existing metric sync cron, plus manual refresh. Failed refresh retains the last report, whose timestamp remains visible. An expired admin session needs reconnecting. Service counts replace the Audience section in the company snapshot; subscription revenue, MRR and YRR are hidden. Existing payment revenue remains available when connected.

Company metric queries and Portfolio Today use service lead/customer counts in preference to Brevo/Stripe counts once connected; the sources are never summed. Service reports retain their source timezone and reporting date.
