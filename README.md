# Krishna Sai Channalli — Developer Portfolio

**Full-stack web developer · Computer Science Engineering student · Bengaluru, India**

A cinematic, scroll-driven portfolio presenting Krishna Sai’s projects, engineering interests, experience, and credentials. The site pairs an interactive visual story with practical project details, evidence-linked skills, and direct contact links.

**Live site:** [channallikrishnasai.github.io/Krishna-Sai-Channalli-portfolio](https://channallikrishnasai.github.io/Krishna-Sai-Channalli-portfolio/)

**GitHub:** [channallikrishnasai](https://github.com/channallikrishnasai) · **LinkedIn:** [Krishna Sai Channalli](https://www.linkedin.com/in/krishna-sai-channalli-4528262b3)

## What’s here

- A single-page portfolio built with HTML, CSS, and vanilla JavaScript.
- A cinematic opening story, animated profile scene, project index, experience archive, achievements, technical skills, and contact section.
- Five featured projects: OPERO, Proofline, VaultIQ AI, InfraVision, and ODIN.
- Interactive project, experience, achievement, and skill details, including flow diagrams and certificate or document previews where available.
- A 240-frame portal sequence controlled by page scroll. It scrubs in either direction, holds its selected frame when scrolling stops, and does not autoplay.
- Progressive frame loading, two concurrent image loads, bounded decoded-image caches, a fallback frame, and smaller cache limits on mobile.
- Responsive layouts, keyboard-accessible controls, reduced-motion support, and safe external links.
- Email, GitHub, LinkedIn, and phone contact actions, including copy-email feedback.

## Featured work

| Project | Focus | Source |
| --- | --- | --- |
| **OPERO** | Full-stack foundation for a governed workflow from request through verification. | [GitHub](https://github.com/channallikrishnasai/OPERO) |
| **Proofline** | Open-source digital forensics and incident response for investigating AI-agent activity. | [GitHub](https://github.com/channallikrishnasai/proofline) |
| **VaultIQ AI** | Personal-finance workflows for budgeting, goals, investment planning, documents, and scenarios. | [GitHub](https://github.com/channallikrishnasai/vaultiq-ai) |
| **InfraVision** | Infrastructure image analysis. The portfolio limits details to the available project material. | No verified public source link is listed. |
| **ODIN** | Local-first Android assistant with configurable assistant and device-provider integrations. | [GitHub](https://github.com/channallikrishnasai/odin-android) |

The Paytm Hackathon detail describes **ArthiX**, the business workspace built for that event, and links to its [public repository](https://github.com/channallikrishnasai/ArthiX). It separates the reported Top 15 selection from the project’s implementation details. The project flow is explanatory and does not claim every documented feature was enabled in the event demo.

Project stacks and capabilities are described from the linked repositories or supplied project materials. Where a public source or implementation detail is unavailable, the portfolio says so rather than presenting an illustrative flow as verified functionality.

## Experience and credentials

- **Codomax Digital Solutions — Full Stack Web Development Intern.** The detail panel previews the completion certificate and letter of recommendation. The internship duration was not supplied.
- **Stoxra Technologies — SEO & Web Development Intern.** The completion certificate records the Growth and Business Development program and the dates **20 August–20 October 2026**; the portfolio also previews the certificate.
- **Google Gemini Student Ambassador.** Presented as a campus ambassador experience; no certificate or external program document is linked.
- Achievement details distinguish the Paytm Top 15 selection, the Inventra Best Project award, builder recognition, hackathon participation certificates, and learning records. Participation is not presented as a ranking or win.

## Technology

The site itself uses **HTML, CSS, and vanilla JavaScript**, with Canvas 2D and `requestAnimationFrame` for the cinematic sequences. Lenis provides smooth scrolling when motion is allowed. Archivo and Instrument Serif load from Google Fonts. There is no build step or npm dependency installation.

The portfolio’s technology groups include the following areas. Project-specific connections are shown only where the available repository or project information supports them; the skill list also includes technologies supplied by Krishna Sai.

- **Languages:** Python, JavaScript, TypeScript, Go, Kotlin, SQL, C, and C++.
- **Web and application development:** React, Next.js, React Native, Expo, Node.js, FastAPI, REST APIs, WebSockets, HTML5, CSS3, Tailwind CSS, Framer Motion, Three.js, and React Three Fiber.
- **Data and infrastructure:** PostgreSQL, Prisma, SQLite, Redis, Supabase, Docker, Linux, Git, and GitHub.
- **AI and agent systems:** AI/ML, generative AI, LLMs, AI agents, multi-agent systems, voice AI, AssemblyAI, agent tool calling, workflow orchestration, tool-permission systems, and human-in-the-loop systems.
- **Computer vision and automation:** ONNX, OpenCV, MobileFaceNet, BlazeFace, MiniFASNet, face recognition, image analysis, ML Kit OCR, browser automation, and Playwright.
- **Engineering areas:** full-stack, frontend, backend, mobile-app, and AI-application development; API integration and automation.

## Scroll-controlled portal

The source sequence contains `frame_0001.jpg` through `frame_0240.jpg` in `assets/portal-scroll/`. Scroll progress selects a corresponding frame; moving upward reverses the sequence, and stopping holds the selected frame. Frames are drawn to canvas with `requestAnimationFrame` while preserving their proportions. Images load progressively, only two are requested concurrently, and the decoded-image cache is capped at 12 frames on desktop and 6 on mobile. If a source frame fails, the portal has a fallback image. With reduced motion enabled, the sequence uses a static final frame.

The original source frames are kept unchanged. The separate opening-story sequences are stored in `assets/fall/` and `assets/portal/`.

## Run locally

You need Python 3 for the simplest local server. From the repository directory, run:

```bash
python -m http.server 8000
```

On Windows, this also works:

```powershell
py -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). No package installation or build command is required. Serving the files over HTTP is more reliable than opening `index.html` directly, especially for the image sequences.

## Deployment

GitHub Pages is configured to publish the repository root from the `main` branch. Push updates to `main` to publish the latest static files. The public site is [here](https://channallikrishnasai.github.io/Krishna-Sai-Channalli-portfolio/). Keep the relative `assets/`, `css/`, and `js/` paths intact.

## Project structure

```text
index.html                 Page structure and content
css/style.css              Layout, responsive styles, and visual effects
js/main.js                 Scroll, canvas, animation, and interaction logic
assets/portal-scroll/      240 user-supplied portal frames
assets/portfolio-scenes/   Five portrait project visuals
assets/certificates/       Certificate and recommendation previews/documents
assets/project-documents/  ArthiX overview document and page previews
assets/fall/, assets/portal/ Original story and ambient image sequences
```

## Contact

- Email: [channallikrishnasai@gmail.com](mailto:channallikrishnasai@gmail.com)
- Phone: [+91 90081 36500](tel:+919008136500)
- GitHub: [github.com/channallikrishnasai](https://github.com/channallikrishnasai)
- LinkedIn: [linkedin.com/in/krishna-sai-channalli-4528262b3](https://www.linkedin.com/in/krishna-sai-channalli-4528262b3)

## Asset and reuse note

The visual system, page structure, animation architecture, and some image sequences derive from the [original portfolio template repository](https://github.com/gireeshkumarreddy/freefall-portfolio) by Gireesh Kumar Reddy; attribution is retained here. The upstream repository has no visible license file, so redistribution terms for those original materials have not been established. This project does not claim a license for third-party material.
