# Contributing

How to build, test and check a change: the README's Contributing section and `docs/testing.md`.
Coding agents read `AGENTS.md` first; its rules apply to every contribution.

## Agent skills

The design and motion skills the project's UI work follows (`animate`, `emil-design-eng`, `apple-design`,
`break-ui`, `mobile-native` and the rest) aren't kept in the repository. `skills-lock.json` lists each one with
its source and hash; to install the same versions, run this in the repository root:

```sh
npx skills experimental_install
```

It restores them into `.agents/skills/` and `.claude/skills/`, which git ignores. That command is marked
experimental by the `skills` tool; if it changes, `npx skills add emilkowalski/skills` adds the same set
(every entry in the lock file comes from that source).

## What this project won't accept

Polarity is a player for media you're entitled to watch. It doesn't provide, host, index or recommend
content, and we don't condone using it to access material without the rights holder's permission.

So we don't accept contributions that add or promote sources of unlicensed content (links, domains,
add-on manifests, magnet or tracker links, IPTV lists, named piracy sites or add-ons), peer-to-peer or
file-sharing features, DRM or paywall circumvention, copyrighted media (frames, posters, logos, trailers,
subtitles) in the repository, code or assets we can't licence, or secrets and personal data. Pull requests
and issues that do will be closed, and links to such material removed.

Third-party add-ons are separate software chosen and installed by the user; the project doesn't ship,
endorse or support them.
