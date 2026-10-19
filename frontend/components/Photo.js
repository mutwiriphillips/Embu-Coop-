"use client";

import { useState } from "react";

// The five farm photographs, served from this site (the hero below can also load from Wikimedia).
// Each has the original file at full resolution (never re-compressed). Where
// it saves a meaningful amount, there is also a 480px-wide copy so phones on
// slow connections download less. The browser
// picks the right one from srcSet/sizes; width/height reserve the space so
// the page doesn't jump while pictures load.
export const PHOTOS = {
  tea:     { small: true,  w: 720, h: 1280, label: "Tea",       alt: "Rows of tea bushes on a hillside beneath shade trees", pos: "50% 72%" },
  dairy:   { small: false, w: 736, h: 1104, label: "Dairy",     alt: "Dairy cows feeding at the rail of a cattle shed",       pos: "42% 40%" },
  poultry: { small: false, w: 720, h: 1280, label: "Poultry",   alt: "A farm worker feeding a flock of brown laying hens",    pos: "50% 62%" },
  coffee:  { small: true,  w: 736, h: 1104, label: "Coffee",    alt: "A coffee tree heavy with ripening red and green cherries", pos: "50% 45%" },
  feed:    { small: true,  w: 736, h: 919,  label: "Farm inputs", alt: "Stacked sacks of animal feed in a farm-supply store", pos: "50% 55%" },
};

export default function Photo({ id, className = "", sizes = "100vw", priority = false, alt }) {
  const p = PHOTOS[id];
  return (
    <img
      src={`/images/${id}.jpg`}
      srcSet={p.small ? `/images/${id}-480.jpg 480w, /images/${id}.jpg ${p.w}w` : undefined}
      sizes={sizes}
      width={p.w}
      height={p.h}
      alt={alt ?? p.alt}
      // "lazy" also keeps the copy of a picture that sits in a hidden layout (e.g. the
      // laptop hero on a phone) from being downloaded; pictures in view still load at once.
      loading="lazy"
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={`object-cover ${className}`}
      style={{ objectPosition: p.pos }}
    />
  );
}

// The landing-page hero: tea pickers carrying baskets, near Embu.
// Source: Wikimedia Commons (see HERO_FILE_PAGE for author and licence).
//   - The Commons photo is requested at several standard widths and fades in
//     over a local copy once it has loaded.
//   - The local copy (hero-640/1000/1599.jpg) is shown first and stays if
//     Wikimedia is unreachable, so the hero is never blank or broken.
// To serve the Commons photo from this site instead, see public/images/README.txt.
const HERO_FILE = "2009.12-363-1071ap_tea,basket,harvesting(picking)_tea-zone_N_of_Embu(C_Highlands),KE_mon14dec2009-1100h.jpg";
export const HERO_FILE_PAGE = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(HERO_FILE)}`;
const remote = (w) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(HERO_FILE)}?width=${w}`;
const REMOTE_SRCSET = [640, 1024, 1280, 1920].map((w) => `${remote(w)} ${w}w`).join(", ");
const HERO_ALT = "Tea pickers in a green tea field near Embu, each carrying a woven basket on their back";

/** fill=true: covers its (relative) parent entirely, for the full-width laptop hero. */
export function HeroPhoto({ className = "", sizes = "100vw", fill = false, position = "50% 45%" }) {
  const [remoteReady, setRemoteReady] = useState(false);
  const base = fill ? "absolute inset-0 h-full w-full" : "";
  return (
    <div className={fill ? "absolute inset-0" : "relative"}>
      <img
        src="/images/hero-1000.jpg"
        srcSet="/images/hero-640.jpg 640w, /images/hero-1000.jpg 1000w, /images/hero-1599.jpg 1599w"
        sizes={sizes}
        width={1599}
        height={1039}
        alt={HERO_ALT}
        fetchPriority="high"
        decoding="async"
        className={`object-cover ${base} ${className}`}
        style={{ objectPosition: position }}
      />
      <img
        src={remote(1280)}
        srcSet={REMOTE_SRCSET}
        sizes={sizes}
        alt=""
        aria-hidden="true"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => setRemoteReady(true)}
        onError={() => setRemoteReady(false)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${remoteReady ? "opacity-100" : "opacity-0"} ${className}`}
        style={{ objectPosition: position }}
      />
    </div>
  );
}
