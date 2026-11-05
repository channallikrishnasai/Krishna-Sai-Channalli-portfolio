# Krishna Sai Channalli — Developer Portfolio

A single-page portfolio for Krishna Sai Channalli, a Computer Science Engineering student at RNS Institute of Technology in Bengaluru. It presents full-stack, AI and interactive software projects through Freefall's original scroll-driven visual story.

## Profile

- **Positioning:** Computer Science Engineering Student · Full-Stack Developer · AI Builder
- **Education:** B.E. Computer Science and Engineering, RNS Institute of Technology, Bengaluru; expected 2029
- **Location:** Bengaluru, India
- **GitHub:** <https://github.com/channallikrishnasai>
- **LinkedIn:** <https://www.linkedin.com/in/krishna-sai-channalli-4528262b3>

## Features

- Original Freefall falling, impact, rise and portfolio story.
- Five project cards for OPERO, FaceRex, VaultIQ AI, InfraVision and CrisisFlow.
- Scroll-controlled, 240-frame portal walk-out animation, scrubbed in both directions and rendered through canvas with `requestAnimationFrame`.
- Progressive image loading, bounded decoded-frame caches for both image sequences, a lower memory budget on mobile, and a fallback frame for the portal sequence.
- Education, completed internship experience, hackathon participation and a categorized skills list.
- Keyboard-accessible project, internship, achievement and technology detail dialogs, with repository links only where a public source is available.
- Project-linked skills based on documented repository information; unverified project stacks, duties and dates are identified as unavailable rather than inferred.
- Navigation menu with active-section indication, external links that open safely, and copy-email feedback.
- Responsive layout, keyboard-accessible navigation, Lenis scrolling when motion is allowed, and a render loop that pauses while the page is hidden.

## Interactive portfolio details

Project cards open a detail dialog with overview, problem, solution, technology, features and implementation notes. FaceRex, InfraVision and CrisisFlow have no verified source links or detailed stack information in the available materials, so their dialogs state those gaps. OPERO and VaultIQ AI link to their documented GitHub repositories. The related The-Opero repository is labeled separately from OPERO.

Internship and achievement cards open detail dialogs. The Codomax role and certificate identifier/date are shown as supplied, but no certificate file or verified destination is available. Stoxra has no supplied role, date or responsibility details. Hackathon participation is separate from the reported Paytm Top 15 selection.

Selecting a skill opens documented project connections when available. The interface does not assign proficiency scores. The menu scrolls to the corresponding section and marks the current chapter; its Escape key closes it. Dialogs can be dismissed with Escape or their close control, return focus to the opening control, and pause smooth scrolling while open. The contact section provides email, GitHub and LinkedIn links and a copy-email button with status feedback.

## Projects and source links

- **OPERO:** The public [OPERO repository](https://github.com/channallikrishnasai/OPERO) describes a request → investigate → decide → act → verify workflow and a Phase 0 full-stack foundation; its README says voice integration is not implemented yet. The related [The-Opero desktop operator](https://github.com/channallikrishnasai/The-Opero) documents Python, PyQt6, Gemini, voice and screen context, and action modules.
- **FaceRex:** Computer-vision face-recognition application with mobile-oriented inference. Project-specific stack and a public source or demo link have not been supplied.
- **VaultIQ AI:** AI-assisted personal-finance application covering budgeting, goals, investment planning, documents and scenario workflows. Its [public repository](https://github.com/channallikrishnasai/vaultiq-ai) documents Next.js, TypeScript, Prisma, Tailwind CSS, SQLite and Supabase PostgreSQL.
- **InfraVision:** AI-based infrastructure damage detection and image analysis. Project-specific stack and a public source or demo link have not been supplied.
- **CrisisFlow:** Emergency-response and crisis-management command system. Project-specific stack and a public source or demo link have not been supplied.

Project details in the portfolio are limited to information supplied by Krishna or described in these public repositories. No unverified demos, performance figures or project links are claimed.

## Experience and achievements

- **Codomax Digital Solutions:** Full Stack Web Development Intern. Certificate CDM/CERT/945434, issued September 2026.
- **Stoxra:** Completed internship; role and dates were not provided.
- Participated in approximately 19 hackathons.
- At the Paytm hackathon, selected among the Top 15 teams out of 2,000+ teams.

## Technology

- **Site:** HTML, CSS and vanilla JavaScript
- **Animation:** Canvas 2D, `requestAnimationFrame`, scroll-driven image sequences
- **Scrolling:** Lenis 1.1.13
- **Fonts:** Archivo and Instrument Serif from Google Fonts
- **Portfolio skills:** React, Next.js, TypeScript, JavaScript, Tailwind CSS, Python, FastAPI, PostgreSQL, Prisma, Redis, Supabase, ONNX, computer vision, Git, GitHub, Docker, Expo, Three.js, React Three Fiber and Framer Motion

The page is static and has no build step or npm dependencies. Lenis and the fonts are loaded from CDNs.

## Scroll-controlled portal animation

The portal section maps normalized scroll progress from 2% through 76% to frames 1 through 240. The selected frame is rounded to the nearest source frame, so scrolling upward reverses the sequence and stopping holds the selected frame. In reduced-motion mode, the final frame is shown statically and navigation jumps do not use Lenis animation.

The original 240 JPEGs are kept unchanged in `assets/portal-scroll/` as `frame_0001.jpg` through `frame_0240.jpg`. The original Freefall sequences remain in `assets/fall/` and `assets/portal/` for the opening story and ambient project-card artwork.

## Run locally

```bash
git clone https://github.com/channallikrishnasai/Krishna-Sai-Channalli-portfolio.git
cd Krishna-Sai-Channalli-portfolio
python -m http.server 8000
```

Open <http://localhost:8000>. On Windows, `py -m http.server 8000` may be used. Directly opening `index.html` may work, but a local server is more reliable for image loading. No package installation is required.

## Deploy

This is a static website. Configure GitHub Pages or another static host to publish the repository root from the `main` branch. No build command is needed. Keep the relative `assets/`, `css/` and `js/` paths intact.

## Credits and attribution

The original Freefall portfolio was created by [Gireesh Kumar Reddy](https://github.com/gireeshkumarreddy/freefall-portfolio). This customized project retains its visual system, animation architecture and source assets, with the additional 240-frame portal sequence supplied for this portfolio.

The upstream GitHub repository currently has no `LICENSE` file, and its README does not state redistribution terms. This project therefore cannot establish permission to redistribute the original code or assets. Attribution is retained, but permission remains unverified and should be confirmed directly with the rights holder before public redistribution. No new license is asserted for third-party material.

## Search and sharing metadata

The page includes a descriptive title and summary, robots directive, SVG favicon, and Open Graph/Twitter preview metadata. The preview uses the final frame already present in the public repository. No canonical URL is declared because a deployed production domain has not been confirmed. Public redistribution of the original Freefall assets remains unverified; see Credits and attribution.
