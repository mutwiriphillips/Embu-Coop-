// The five farm photographs, served from this site (no outside hosts).
// Each has the original file at full resolution (never re-compressed). Where
// it saves a meaningful amount, there is also a 480px-wide copy so phones on
// slow connections download less. The browser
// picks the right one from srcSet/sizes; width/height reserve the space so
// the page doesn't jump while pictures load.
export const PHOTOS = {
  farmers: { small: false, w: 736, h: 1096, label: "Farmers",   alt: "Farmers weeding and tending a maize field together under a bright sky", pos: "50% 78%" },
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
