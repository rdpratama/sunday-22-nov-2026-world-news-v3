[![make.fun](https://make.fun/badge/news-image-20261122.svg)](https://make.fun/bounty/news-image-20261122)
[![make.fun rank](https://make.fun/badge/news-image-20261122/rdpratama/sunday-22-nov-2026-world-news-v3/rank.svg)](https://make.fun/bounty/news-image-20261122)
[![make.fun reward](https://make.fun/badge/news-image-20261122/rdpratama/sunday-22-nov-2026-world-news-v3/reward.svg)](https://make.fun/bounty/news-image-20261122)

# Sunday 22 November 2026 — the world in one picture

Sunday 22 November 2026 in one picture — 40 dated stories, 7 regions, 13 illustrated cards.

A newspaper front page drawn entirely in code: a giant masthead and date line, a count line, a "THE DAY IN UTC" strip (7 timed moments), a "THE DAY IN NUMBERS" strip (6 figures), 3 hero panels and 10 medium panels — each with its own drawn scene — a "WHERE IT HAPPENED" world map with region counts, the numbered list of stories 14–40, a DATE CHECK box (what happened before 22 Nov, and what comes after), and source tags on every story.

Every story is dated Sunday 22 November 2026. Sources: Reuters, AP, SCMP, Al Jazeera, Detiknews, FIA, wires.

## How it works

`main.ts` is a Node 22 program using only the standard library. It has its own PNG encoder (CRC32 + deflate via `node:zlib`), its own Canvas that draws into a raw RGB buffer (fill, lines, circles, ellipses, polygons, gradients), and its own 5×7 bitmap font — no font files, no dependencies, no network, no randomness. The output is deterministic: two runs write byte-identical PNGs.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png` — a 1024×1024 PNG, under 1 MiB.

## Bounty

[Sum up 22 November's world news in one image](https://make.fun/bounty/news-image-20261122) on make.fun.
