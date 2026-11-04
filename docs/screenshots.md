# Screenshots and recordings

README images should show only content we're allowed to show. A frame from a current film or TV
episode isn't (see `docs/legal-review.md` L2). For the player, use one of the Blender Foundation's
open movies. Use them for posters and backdrops too, where you can.

## The films and their licences

All three are licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
You may show them anywhere, including commercially, as long as you credit them the way each
project asks:

| Film | IMDb | Licence statement | Credit to put under the image |
|---|---|---|---|
| Sintel (2010) | `tt1727587` | "The results of the Durian Open Movie project are being licensed under the Creative Commons Attribution 3.0 license" ([durian.blender.org/sharing](https://durian.blender.org/sharing/)) | `© copyright Blender Foundation \| durian.blender.org` |
| Tears of Steel (2012) | `tt0000107` | Mango project content is "being licensed under the Creative Commons Attribution 3.0 license" ([mango.blender.org/sharing](https://mango.blender.org/sharing/)) | `(CC) Blender Foundation \| mango.blender.org` |
| Big Buck Bunny (2008) | `tt1254207` | "The results of the Peach open movie project has been licensed under the Creative Commons Attribution 3.0 license" ([peach.blender.org/about](https://peach.blender.org/about/)) | `(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org` |

Some things these licences don't cover:
- **Logos and trademarks.** The Blender, Durian, Mango and Creative Commons logos and sponsor logos
  are excluded (same sharing pages). A frame from the film is fine. Don't use the project logos as
  art.
- **Tears of Steel's music.** The original soundtrack files are licensed separately, under CC BY-ND
  3.0, with the credit `(C) Joram Letwory - www.tearsofsteel.org`
  ([copyright.txt](https://download.blender.org/demo/movies/ToS/copyright.txt)). A silent
  screenshot doesn't touch it. For a recording with sound, use Sintel or Big Buck Bunny, or add
  that credit as well.
- **Redistributing the whole film.** Sintel's page asks that a full screening or redistribution
  include the entire credits scroll. A screenshot or a short clip is an "other use", and the line
  above is enough.
- **Posters from TMDB.** Search results and title pages show whatever art TMDB holds for the film.
  That art is the uploader's, not necessarily the Blender Foundation's. For the player shot this
  doesn't matter. For a home-screen shot, prefer titles whose TMDB art comes from the film itself.

The IMDb ids come from Wikidata (P345) for Tears of Steel and Big Buck Bunny. Sintel's is the one
its Russian Wikipedia article gives. If a search in Polar opens a different title, use that title's id
instead.

## Playing one in Polar

Polar plays streams from addons, so `scripts/open-films-addon.ts` is a small local addon that offers
a stream for these three films and nothing else:

```sh
bun scripts/open-films-addon.ts
# Big Buck Bunny is only published zipped: download and unzip it first, then
bun scripts/open-films-addon.ts --file tt1254207=/path/to/big_buck_bunny_1080p_h264.mov
```

1. Start Polar (`bun run app`). In Settings → Add-ons, add
   `http://127.0.0.1:7878/manifest.json`.
2. Search for "Sintel" (or the other titles), open it, and pick the source "Open films".
   - Sintel streams `Sintel.2010.1080p.mkv` (1.2 GB) from download.blender.org.
   - Tears of Steel streams `tears_of_steel_720p.mov` (370 MB).
   - To play from disk instead, pass `--file <imdb id>=<path>` for any of them. Downloads are at
     [download.blender.org/durian/movies](https://download.blender.org/durian/movies/),
     [/demo/movies/ToS](https://download.blender.org/demo/movies/ToS/) and
     [/peach/bigbuckbunny_movies](https://download.blender.org/peach/bigbuckbunny_movies/).
3. Seek to a frame that shows the film well (Sintel around 4:00–6:00 is a good choice). Move the
   mouse so the bottom bar is showing, and open a menu (subtitles, sources) if you want it in the
   shot. Sintel and Tears of Steel come with subtitle files at the same download pages.
4. Take the screenshot at the window's normal size, without the desktop around it:
   - macOS: ⇧⌘4, then Space, then click the window. Hold ⌥ when you click to leave out the shadow.
   - Windows: Win+Shift+S, window mode.
5. For a short recording (a few seconds of scrubbing or opening the bar), use ⇧⌘5 on macOS or
   Win+Alt+R on Windows. Convert it to a small looping GIF or MP4 under about 5 MB, for example
   `ffmpeg -i in.mov -vf "fps=15,scale=900:-1" -t 8 readme-images/player.gif`.
6. Remove the addon from Polar afterwards if you don't want it in your synced settings.

## Putting it in the README

Save the image as `readme-images/player.png` (or `player.gif`). Then, in README.md's Player
section, uncomment the image line and keep the credit line under it, filled in for the film you used.

Check before you commit:
- no account email, profile name, avatar photo or local file path is visible;
- no other add-on, title or poster is visible apart from the open film;
- the credit line names the film and the project's own wording from the table above.
