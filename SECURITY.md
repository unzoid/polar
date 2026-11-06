# Security

Security research on Polarity is welcome. This page says what you can test, what needs permission first, and
how to report what you find.

## Reporting a vulnerability

Report it privately, never in a public issue, pull request or discussion:

- **GitHub's private vulnerability reporting** (the repository's Security tab → "Report a vulnerability"),
  once the maintainers have turned it on.
- Until then, open an issue with the **Security vulnerability** form, which asks only for a private way to
  send the report. Don't include any details in it.

Please include what is affected, how to reproduce it, and what an attacker could do with it. You'll get an
answer as soon as the maintainers can, and credit in the fix if you want it.

## What anyone may test

No permission needed:

- Reviewing the source code, including with automated tools.
- Building and running the app and its server parts on your own machines, against your own local Supabase
  (the schema is in `supabase/`), your own add-ons and your own test data.
- Fuzzing parsers and inputs, and attacking your own local setup in any way.

## What needs written permission first

Testing the project's hosted services (the account server on Supabase and the website at getpolar.app) needs
written permission from the maintainers for a stated scope and period. Within that permission:

- Use only accounts you created for the test.
- Don't access, change or keep other people's data. If you reach any, stop, don't use it, and report it.
- No denial of service, load or volume testing, and no spam through sign-in emails.
- No social engineering of the maintainers or users, and no physical attacks.
- Stop and report as soon as you find something serious, rather than going further.

## Out of scope

- Third-party services Polarity talks to: Supabase's and Cloudflare's own platforms, TMDB, AniList, MyAnimeList
  and the other data sources, Discord, and GitHub. Report problems in those to their owners.
- Users' add-ons and the streams they return.
- Reports that need a device that is already compromised, or that only show a missing best practice with no
  way to exploit it.

## Safe harbour

Research done in good faith within this page, and within any written permission for the hosted services,
won't lead to legal action or complaints from the maintainers. If in doubt about whether something is in
scope, ask first.
