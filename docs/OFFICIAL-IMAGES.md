# Official Rockstar images

The site shows **official Rockstar images** for the eight characters, the six regions, every article (hero, card and social-share image) and the home page as soon as the files are in `assets/official/`. Anything without an official image uses our own gameplay screenshot (`assets/ours/art/`, credited "Screenshot: Neon Atlas"). **Generated or AI art is never used** (see the rule in `CLAUDE.md`); with no real picture, a page simply shows none. Official images are credited "Image: Rockstar Games".

## The quick way (two commands)

```bash
npm run fetch-official     # downloads Rockstar's own GTA VI media (rockstargames.com only) into .official-cache/
npm run import-official    # crops them into assets/official/ (characters, regions, articles, home hero)
npm test
```

**Which picture goes on which article** is set in `data/official-art.json`: `src` is the start of Rockstar's file name
(e.g. `Vice_City_06`), `focus` is the crop centre. Change an entry and run `npm run import-official -- --force` to redo the
crops; delete an entry to remove that official image (the page then uses our own screenshot if there is one, otherwise no picture). A new article gets an official image by adding a line there.
When Rockstar releases new screenshots (the watcher reports it), run `npm run fetch-official` again; only new files download.

## The manual way

The site shows **official Rockstar images** for the eight characters and six regions as soon as the files are in `assets/official/`. Until then it shows the original Neon Atlas artwork. Every official image is captioned "Image: Rockstar Games".

## Why you add them (and not the build)

Rockstar's media page says "Download and share trailers, imagery, and more", which is the press kit sites use for coverage. Using it on a site with ads is still your decision as the publisher. Use these images editorially (next to the facts they illustrate), keep the credit, don't edit or watermark them, and remove any image immediately if Rockstar asks.

## Steps (about 10 minutes)

1. Open **https://www.rockstargames.com/VI/only-in-leonida** in your browser.
2. For each character (Jason Duval, Lucia Caminos, Cal Hampton, Boobie Ike, Dre'Quan Priest, Real Dimez, Raul Bautista, Brian Heder) and each region (Vice City, Leonida Keys, Grassrivers, Port Gellhorn, Ambrosia, Mount Kalaga), right-click one image → **Save image as…** into one folder (for example `Downloads/gta6-official`). **Keep Rockstar's file name** (e.g. `Jason_Duval_01.jpg`); the tool finds images by name.
   - Or: on **https://www.rockstargames.com/VI/media**, use **Screenshots → Download All**, unzip it, and use that folder. Any characters missing from the zip can be saved from the page above.
3. Run:

```bash
npm run import-official -- ~/Downloads/gta6-official
npm test
```

The tool crops portraits to 600×750 and regions to 960×540, lists which ones it found, and tells you which are still missing. Commit and push, and the site deploys.

Replace an image later: save a different file (e.g. `Lucia_Caminos_04.jpg`), delete the old one from `assets/official/characters/`, and run the tool again (or use `--force`).
