Pictures used by the site.

Farm photographs (already here, served from this site, nothing loaded from outside):
  tea.jpg dairy.jpg poultry.jpg coffee.jpg feed.jpg   original files, untouched
  tea-480.jpg coffee-480.jpg feed-480.jpg              smaller copies for phones

Optional self-hosted national emblem and map. Save these two with EXACTLY these
names; the site uses them first and falls back to Wikimedia if they are missing:
  coat-of-arms.svg  <- the official Coat of Arms of Kenya (use the State's own copy)
  county-map.svg    <- a labelled map of Kenya's 47 counties
Once both are here, remove the two wikimedia.org entries from img-src in next.config.js.

HERO PHOTO
The landing-page hero loads the Wikimedia Commons photo "2009.12-363-1071ap tea,basket,harvesting(picking) tea-zone N of Embu" from Commons, over a local fallback (hero-640/1000/1599.jpg, currently the tea-pickers photo supplied earlier).
To host the Commons photo yourself (faster, no outside dependency): download the original from its Commons file page, then make three sizes with, for example,
  npx sharp-cli -i original.jpg -o hero-640.jpg resize 640 --quality 78
  npx sharp-cli -i original.jpg -o hero-1000.jpg resize 1000 --quality 78
  npx sharp-cli -i original.jpg -o hero-1599.jpg resize 1599 --quality 74
and put the three files in this folder (replacing the old ones). Keep the credit link in the footer; check the licence on the file page.
