# Decisions

Choices made where the brief left room, with the reason for each.

## Rules

1. **Wins are multiples of the base bet in every mode.** The ante bet costs 1.25 x the bet and the buy feature 100 x, but pays are always computed on the bet itself. RTP for each mode is measured against what the round actually costs.

2. **Scatters are counted once per spin, after the tumbles finish.** Scatters are never removed, so more can arrive during tumbles. Counting at the end means the scatter pay and the trigger always use the same number, and a spin can never pay scatters twice.

3. **Bombs multiply the whole spin win, including any scatter pay in that spin.** The brief says the bomb total multiplies "that spin's total win", so the scatter pay is part of it. If a free spin wins nothing, its bombs do nothing.

4. **The max win applies to the whole round** (paid spin plus its free spins), at 21,100 x the base bet. It is checked after each spin; the spin that crosses it is the last one played and the round pays exactly the cap. Bombs only apply when a spin's tumbles end, so there is nothing meaningful to check mid-spin.

5. **A bought spin lands exactly the scatters it is given** (4, 5 or 6, weighted like natural triggers: 89.7%, 9.4%, 0.9%) and no extra ones. Without this, forcing four scatters and then drawing more at random made six scatters (100 x) far more common on bought spins than on natural triggers, and about a tenth of the buy price came from scatter pays rather than free spins.

6. **Retriggers have no limit.** Three or more scatters always add five spins. The retrigger chance is low enough that features average 11.3 spins, and the max-win cap bounds the round in any case.

7. **The buy feature costs 100 x the base bet and is unavailable while the ante is on**, as specified. The ante toggle and bet are locked during a round and during autoplay. Autoplay never buys.

8. **Bet ladder:** 0.20, 0.40, 0.60, 0.80, 1, 1.50, 2, 3, 4, 5, 7.50, 10, 15, 20, 25, 30, 40, 50, 75, 100. Payouts and stakes are rounded to whole cents; the only stakes affected are the ante at 1.50 (1.88) and 7.50 (9.38).

## Math model

9. **Independent weighted draws instead of reel strips.** Every position, on the first drop and on every refill, is drawn from one weighted bag. This is simple to reason about, quick to simulate and easy to retune: a weight is just a number of tickets in the bag.

10. **"Hot symbol" spins for volatility.** With plain independent draws and this paytable, reaching the target return needed wins on well over half of all spins, nearly all smaller than the bet: a flat, low-volatility game. Real reel strips avoid that by clumping symbols. The equivalent here: on 38.4% of base spins (28% of free spins) one symbol is picked and its weight is multiplied for that whole spin (x3 in the base game, x8 in free spins). The result is a 37.7% hit rate with a long tail, without touching the paytable. It is the one mechanic not in the brief, it is invisible to the player as a rule (it only shapes how often symbols cluster), and it can be switched off by setting `chancePer1000` to 0.

11. **One set of symbol weights for all three bags.** The base, ante and free-spin bags differ only in scatters, bombs and the hot-symbol settings. Fewer numbers to tune, and the ante bet is honestly "the same game with more scatters".

12. **The ante trigger frequency is 2.02 x the base game's** (1 in 190.6 against 1 in 384.1). Weights are whole numbers, so an exact 2.000 is not available; this was the closest setting that also put the ante RTP on target.

13. **Bomb values average 7.2 x.** All thirteen values from the brief are used, with weights falling steadily from 2 x (20.8% of bombs) to 100 x (0.6%).

14. **The max win is effectively unreachable.** In 220 million simulated rounds the largest win was 13,053 x, so the 21,100 x cap never fired. The cap is implemented and tested (with a deliberately extreme test config); making it reachable in normal play would need bigger or more frequent bombs and a lower return elsewhere.

15. **RTP is reported two ways.** A direct count (winnings / stakes), and a "combined estimate" that takes the average free-spins payout from the buy-feature run, where it is measured far more precisely. 10 million base-game rounds only fix the direct RTP to about ±0.3%, which is not enough to check a ±0.5% tolerance with confidence, so MATH.md uses 100 million rounds and shows both figures.

16. **Seeds are integers up to 2^53 - 1**, fed through splitmix32 into xoshiro128\*\*. Neighbouring seeds give unrelated streams, so the simulator simply uses seed, seed + 1, seed + 2 and so on, and any simulated round can be replayed by its seed. Each mode uses its own seed range.

17. **A safety limit of 100 tumbles per spin.** A real spin never gets near it; it stops a broken config (for example a single-symbol bag) from looping forever.

## Interface

18. **PixiJS draws the board; HTML draws the controls.** The board, symbols, win effects, bomb collection and banners are a Pixi scene. The balance, bet, buttons, paytable and dialogs are ordinary HTML and CSS, which gives keyboard access, real dialogs and a responsive layout with far less code than rebuilding them on a canvas.

19. **Artwork is drawn in code.** Each symbol is a few vector shapes baked into a texture at start-up, so there are no image files and nothing copied. Replacing one means editing one function in `symbolArt.ts`, or swapping the texture for an image.

20. **The outcome is saved before the animation plays.** The engine decides the round the moment Spin is pressed, and the final balance is written to localStorage immediately. The on-screen balance shows the stake coming off and catches up when the win has been revealed. Closing the tab mid-animation therefore never loses a win.

21. **Free spins use the triggering spin's bet**, and the "Win" figure shows the current spin while "Feature total" shows the round so far.

22. **Big-win sequence tiers:** Big win from 20 x, Huge win from 60 x, Colossal win from 200 x, with a longer count-up and confetti at each step. A feature always ends with a summary banner, whatever it paid.

23. **Turbo** speeds every animation up 2.6 x rather than skipping any, so the round reads the same.

24. **Sound is synthesised** with WebAudio (short tones), off by default, so there are no audio files.

25. **Spacebar behaviour.** Space spins when the game is idle and closes an open banner. After a mouse or touch press the pressed button gives up focus, so space keeps spinning rather than repeating the last button; a button focused with the keyboard keeps its normal space behaviour.

26. **If playback ever fails**, the game logs the error, shows the final board, credits the already-decided payout and returns to idle instead of freezing.

27. **Starting balance is 10,000 credits**, enough to buy the feature at a bet of 100 once.

28. **Fonts are bundled** (Lilita One, Nunito, from the `@fontsource` npm packages) so the game makes no network requests once it is running locally.
