# Image to STL Converter

Turn a JPG, PNG or WebP image into a printable heightmap relief or flat lithophane STL, entirely in the browser.

**Live version:** https://freeimagetostl.com/

## Features

- Two modes: heightmap relief (bright areas are raised) and flat lithophane (dark areas are thicker)
- Width in millimeters, with the depth following the image's aspect ratio
- Base thickness and relief height for reliefs; minimum and maximum thickness plus an optional border frame for lithophanes
- Resolution from 50 to 600 samples across, 0 to 5 smoothing passes, and an invert switch
- Live three.js preview with orbit controls, a height map thumbnail, and the triangle count and file size shown before you download
- Closed, watertight binary STL in millimeters
- Load an image from a file, by drag and drop or from the clipboard
- No upload, no server and no tracking

## Run it locally

The page uses ES modules, so serve the folder over HTTP rather than opening the file directly:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How it works

The browser decodes the image and the page scales it so its longer side is at most 2000 px. Each pixel becomes a luminance value (Rec. 709 weights, transparency composited over white), and the grid is area-averaged down to the resolution you pick, then softened with a 3x3 box blur for each smoothing pass. Each sample becomes a vertex whose height is a linear mix of the two thickness values, and the top surface is stitched to four side walls and a flat bottom, so every edge belongs to exactly two triangles.

## Limits

- The output is a 2.5D relief: the surface follows the picture's brightness, and the back is flat. It cannot rebuild the sides or back of an object in a photo.
- Lithophanes are flat panels only. Curved, cylindrical and spherical shapes are not supported.
- STL has no color, texture or unit field. Slicers read the numbers as millimeters.
- At 600 by 600 samples the file is about 36 MB, so large settings can be slow on older machines.

Need a full 3D model of a furniture piece from one photo? FurniMesh (https://furnimesh.com/image-to-3d?utm_source=github-image-to-stl-converter&utm_medium=referral&utm_campaign=best-network) is made by the same team.

## Licenses

- Code in this repository: MIT, see `LICENSE`.
- three.js 0.187.0 (`vendor/three.module.min.js`, `vendor/three.core.js`, `vendor/OrbitControls.js`): MIT, see `vendor/three.js-LICENSE.txt`.
