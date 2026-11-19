# Local changes to the vendored ASCII Magic runtime

Source: https://www.ascii-magic.com/ascii/ (MIT, see LICENSE.txt). Self-hosted so the
background and loading screen work offline (LifeOS is an offline-first PWA).

Two small patches, both performance-only:

1. `ascii.js` — new `fps` attribute, forwarded to the player's existing `maxFps`
   option. LifeOS runs the background galaxy at 6 fps (it rotates slowly; 24 fps
   cost ~37% of a CPU core for no visible gain).
2. `player.js` — every player skips frames while `<html data-ascii-paused>` is set.
   LifeOS sets it while the user scrolls, drags, or has an overlay open, so the
   background never competes with interaction. Animation time does not advance
   while paused, so it resumes without a jump.
