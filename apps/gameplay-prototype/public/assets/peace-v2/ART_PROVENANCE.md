# Gameplay prototype scene art

- `sideview-geology-atlas.png` is derived from the four authored 256×256
  geology frames in `apps/client-v2/public/assets/peace-v2/underground-atlas-1024.png`.
  Each frame is mirrored horizontally to reduce hard repeat seams and packed
  into a 2×2 atlas. The source application's asset was not modified.
- `sideview-turf-tile.png` is a meadow crop from this prototype's existing
  `background-panorama.png`, mirrored horizontally to make a wider seamless
  tile. No synthetic fill or placeholder color was introduced.
- The requested newly generated terrain illustration could not be produced in
  this session because the image service returned `Invalid credential`.
  Runtime visuals use only the existing authored image sources listed above.
