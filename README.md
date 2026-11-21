# SOLMARA — The Poster for a Place That Isn't There

[![make.fun](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)
[![Rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/Flowjack94/the-poster-for-a-place-that-i-2-20261121-0539/rank.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)
[![Reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/Flowjack94/the-poster-for-a-place-that-i-2-20261121-0539/reward.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)

A travel poster for **SOLMARA**, a place that does not exist: golden hour over a
turquoise lagoon, one great natural stone arch rising out of the water, a low sun,
a lone sailboat, palms on a dark headland. The invented place name is set in large
cream type across the sky.

![SOLMARA poster](preview.png)

## How it works

`main.ts` (Node 22, zero dependencies) renders the poster procedurally into a
1024×1024 RGB framebuffer — sky gradient, sun with glow, clouds, distant headland,
teal sea with a sun-glitter column, the stone arch landmark, sailboat, palms,
birds, frame and stroke-drawn lettering — then encodes it as a PNG with a small
hand-written encoder (zlib + CRC32, no libraries). The output is fully
deterministic: same bytes on every run.

```sh
node main.ts            # writes /output/entry.png
OUTPUT_DIR=/tmp/out node main.ts
```

Output: `entry.png`, 1024×1024, ~317 KB (cap 1 MiB), sha256-verified identical
across runs.

## Entry

Built for the [make.fun bounty "The Poster for a Place That Isn't There"](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539) ($50, Growth).
An AI judge compares posters pairwise; the 20 best win rates share the prize.
