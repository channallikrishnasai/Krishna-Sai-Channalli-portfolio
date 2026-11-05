# Krishna Sai — Personal Portfolio

A single-page, scroll-driven portfolio based on Freefall. It keeps the original falling sequence and story, with a custom 240-frame portal walk-out at the end.

## Features

- Full-page portfolio story with a pinned, scroll-driven opening sequence.
- Original falling-film frames, impact transition, crowd/rise sequence, selected work, about, services, portal and contact sections.
- Custom portal animation made from 240 sequential JPEG frames at 1280×720 (16:9, 24 fps). The frame follows scroll position in both directions and holds while scrolling is stopped.
- Canvas rendering synchronized through `requestAnimationFrame`.
- Progressive frame loading with two requests in flight, a 12-frame decoded-image cache, first/last-frame retention and an original-film fallback.
- Reduced-motion mode holds the portal on its final frame.
- Responsive layout and smooth scrolling through Lenis.

## Technology

- HTML, CSS and vanilla JavaScript
- Canvas 2D rendering and `requestAnimationFrame`
- Lenis 1.1.13 and Google Fonts loaded from their CDNs
- Python's built-in static HTTP server for local development; no build step or package installation is required

## Scroll-controlled portal animation

The portal section maps normalized section scroll progress from 2% through 76% to frames 1 through 240. The selected frame is rounded to the nearest source frame. Scrolling upward reverses the sequence. In reduced-motion mode, the final frame is shown statically.

The source frames are stored without modification in `assets/portal-scroll/` as `frame_0001.jpg` through `frame_0240.jpg`. The original Freefall sequences remain in `assets/fall/` and `assets/portal/` for the main story and existing page imagery.

## Installation

Clone the repository, then enter its directory:

```bash
git clone https://github.com/channallikrishnasai/krishna-sai-portfolio.git
cd krishna-sai-portfolio
```

There are no npm dependencies to install. The page loads its fonts and Lenis from CDNs, so those resources need an internet connection.

## Local development

Run a static server from the repository root:

```bash
python -m http.server 8000
```

Open <http://localhost:8000>. `py -m http.server 8000` can be used on Windows where the launcher is available. Directly opening `index.html` may work, but the local server is more reliable for browser asset loading.

## Deployment

This is a static site. It can be deployed from the repository root to GitHub Pages or another static host without a build command:

1. Select the `main` branch and repository root as the Pages source (or the equivalent root-directory setting on another host).
2. Publish the site and open the host-provided URL.
3. Confirm the relative `assets/`, `css/` and `js/` paths are served unchanged.

## Credits and attribution

The original Freefall portfolio was created by Gireesh Kumar Reddy: <https://github.com/gireeshkumarreddy/freefall-portfolio>. This repository includes a customized version of that work and preserves its original experience and assets, with the additional 240-frame portal sequence supplied for this portfolio.

The upstream repository did not include a `LICENSE` file when checked. Redistribution is based on separate authorization from the rights holder; the source project is credited above. No new license is asserted for third-party material.

## Before publishing your personal details

The original page copy still contains the template name, sample case studies and contact details. Update those in `index.html` before presenting the site as a finished personal portfolio.
