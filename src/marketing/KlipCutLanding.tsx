/**
 * KlipCutLanding.tsx — Marketing landing page for KlipCut Video Editor
 */
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./KlipCutLanding.css";

gsap.registerPlugin(ScrollTrigger);

const Scene3D = lazy(() => import("./Scene3D"));

/* ============================ CONFIG ============================ */
const env = import.meta.env;
const APP = {
  name: "KlipCut",
  version: env.VITE_APP_VERSION || "0.1.0",
  size: env.VITE_DOWNLOAD_SIZE || "~ 56 MB",
  os: "Windows 10 / 11 (64-bit)",
  // Vercel build fills these from the latest GitHub Release. Local fallback
  // is a file dropped in public/downloads.
  downloadUrl:
    env.VITE_DOWNLOAD_URL || "/downloads/KlipCut_0.1.0_x64-setup.exe",
  fileName: env.VITE_DOWNLOAD_NAME || "KlipCut_0.1.0_x64-setup.exe",
  contact: "hello@klipcut.app",
};

const FEATURES = [
  {
    icon: "layers",
    title: "Multi-layer timeline",
    desc: "Unlimited tracks, magnetic snap, ripple edit, and buttery multi-select — cut on the exact frame you want.",
    wide: true,
  },
  {
    icon: "bolt",
    title: "GPU-accelerated render",
    desc: "Leverage NVENC, QuickSync, and AMF to export video many times faster.",
  },
  {
    icon: "wand",
    title: "Effects & transitions",
    desc: "A ready-made library of effects, transitions, and text animations — just drag and drop.",
  },
  {
    icon: "palette",
    title: "Pro color grading",
    desc: "Curves, LUTs, wheels, and scopes help your footage look cinematic.",
  },
  {
    icon: "wave",
    title: "Crystal-clear audio",
    desc: "Frame-accurate waveforms, noise reduction, and automatic level balancing.",
  },
  {
    icon: "export",
    title: "Export any format",
    desc: "MP4, MOV, GIF, plus presets for YouTube, TikTok, and Reels. Up to 4K/60fps.",
    wide: true,
  },
];

const STEPS = [
  { n: "01", title: "Import media", desc: "Drag in video, images, and audio. KlipCut builds proxies so preview stays smooth even with heavy 4K footage." },
  { n: "02", title: "Cut & arrange", desc: "Smart shortcuts, instant splits, speed changes, reverse, and layering — done in seconds." },
  { n: "03", title: "Add the magic", desc: "Effects, transitions, titles, and color — all in real time, with no waiting on a render." },
  { n: "04", title: "Ship it", desc: "Pick a preset and hit Export. GPU-backed background render lets you keep working while it finishes." },
];

const STATS: { v: number; suffix: string; prefix?: string; label: string }[] = [
  { v: 120, suffix: "+", label: "Effects & transitions" },
  { v: 4, suffix: "K", label: "Export up to 60 fps" },
  { v: 10, suffix: "x", label: "Faster render with GPU" },
  { v: 0, suffix: "", prefix: "$", label: "Cost to get started" },
];

const FAQ = [
  { q: "Is KlipCut free?", a: "You can download and try it right away. Update this answer with your pricing and license details." },
  { q: "Which operating systems are supported?", a: "KlipCut currently supports Windows 10 and Windows 11 (64-bit). Other platforms will come later." },
  { q: "What are the minimum requirements?", a: "A 4-core CPU, 8 GB RAM, and a DirectX 11 GPU. For smooth 4K editing, 16 GB RAM and a discrete GPU are recommended." },
  { q: "Windows shows 'Unknown publisher' when installing?", a: "That's a normal SmartScreen warning for new software. Choose More info → Run anyway to continue." },
];

const MARQUEE = ["CUT", "COMPOSE", "COLOR", "EFFECTS", "AUDIO", "SUBTITLES", "EXPORT 4K", "GPU", "TIMELINE"];

/* ============================ ICONS ============================ */
const ICONS: Record<string, string> = {
  layers: "M12 3 2 8l10 5 10-5-10-5Zm-8.5 9L12 16.2 20.5 12M3.5 16 12 20.2 20.5 16",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  wand: "m15 4 5 5M4 20 16 8l-1-1L3 19l1 1Zm13-15 1-2m3 5 2-1m-5-2-2-2",
  palette: "M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-1.2-1-1.7-1-2.7 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z",
  wave: "M3 12h2m3-5v10m4-13v16m4-12v8m4-5v2",
  export: "M12 3v12m0-12 4 4m-4-4-4 4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4",
  download: "M12 3v12m0 0 5-5m-5 5-5-5M4 21h16",
  windows: "M3 5.5 11 4.4v7H3v-6Zm9 -1.2L21 3v8.4h-9V4.3ZM3 12.6h8v7l-8-1.1v-5.9Zm9 0h9V21l-9-1.3v-7.1Z",
  plus: "M12 5v14M5 12h14",
  play: "M7 4v16l13-8L7 4Z",
};
type IconProps = { name: string; size?: number; fill?: boolean };
const Icon = ({ name, size = 22, fill }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={ICONS[name]} />
  </svg>
);

const Logo = () => (
  <span className="logo">
    <img src="/klipcut-logo.svg" width={26} height={26} alt="" draggable={false} />
    {APP.name}
  </span>
);

/* ============================ HOOKS ============================ */
function useMagnetic<T extends HTMLElement>(strength = 0.35) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const xTo = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3" });
    const move = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * strength);
      yTo((e.clientY - (r.top + r.height / 2)) * strength);
    };
    const leave = () => { xTo(0); yTo(0); };
    el.addEventListener("mousemove", move);
    el.addEventListener("mouseleave", leave);
    return () => {
      el.removeEventListener("mousemove", move);
      el.removeEventListener("mouseleave", leave);
    };
  }, [strength]);
  return ref;
}

/* ============================ MOCKUP EDITOR ============================ */
const MOCK_TRACKS: { label: string; clips: { l: number; w: number; c: string; t: string }[] }[] = [
  { label: "V2", clips: [{ l: 6, w: 22, c: "#6b7cff", t: "Title" }, { l: 40, w: 18, c: "#d57a9c", t: "Overlay" }, { l: 72, w: 20, c: "#6b7cff", t: "Outro" }] },
  { label: "V1", clips: [{ l: 0, w: 30, c: "#5b9fff", t: "Intro.mp4" }, { l: 31, w: 26, c: "#3db8c9", t: "Scene_02.mov" }, { l: 58, w: 38, c: "#5b9fff", t: "Drone_4K.mp4" }] },
  { label: "A1", clips: [{ l: 0, w: 55, c: "#c9a05a", t: "Music.wav" }, { l: 57, w: 40, c: "#c9a05a", t: "Voiceover.wav" }] },
];

const EditorMock = () => {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    // Only the playhead + a light wave pulse — blobs are CSS (no GSAP on blur layers)
    let ctx: gsap.Context | null = null;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          ctx?.revert();
          ctx = null;
          return;
        }
        if (ctx) return;
        ctx = gsap.context(() => {
          gsap.to(".mk-playhead", {
            left: "100%",
            duration: 10,
            ease: "none",
            repeat: -1,
          });
          gsap.to(".mk-wave i", {
            scaleY: () => gsap.utils.random(0.4, 1),
            duration: 1.1,
            stagger: { each: 0.08, repeat: -1, yoyo: true },
            ease: "sine.inOut",
          });
        }, el);
      },
      { rootMargin: "40px", threshold: 0.1 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      ctx?.revert();
    };
  }, []);

  return (
    <div className="mock" ref={root}>
      <div className="mk-bar">
        <span /><span /><span />
        <b>KlipCut — Untitled Project.cut</b>
      </div>
      <div className="mk-body">
        <aside className="mk-bin">
          {["Intro.mp4", "Scene_02.mov", "Drone_4K.mp4", "Music.wav", "Logo.png", "Voiceover.wav"].map((f, i) => (
            <div key={f} className="mk-file"><i style={{ background: ["#5b9fff", "#3db8c9", "#5b9fff", "#c9a05a", "#d57a9c", "#c9a05a"][i] }} />{f}</div>
          ))}
        </aside>
        <div className="mk-preview">
          {/* Soft glow via layered gradients — no animated filter:blur (was the lag source) */}
          <div className="mk-glow-bg" aria-hidden />
          <div className="mk-caption">Cut fast. Edit beautifully.</div>
          <div className="mk-ctrl"><Icon name="play" size={14} fill /><div className="mk-scrub"><div /></div><span>00:12:08</span></div>
        </div>
        <aside className="mk-insp">
          {[80, 55, 70, 40, 62].map((w, i) => (
            <div key={i} className="mk-row"><span /><div><i style={{ width: `${w}%` }} /></div></div>
          ))}
          <div className="mk-wave">{Array.from({ length: 22 }).map((_, i) => <i key={i} />)}</div>
        </aside>
      </div>
      <div className="mk-timeline">
        <div className="mk-ruler">{Array.from({ length: 11 }).map((_, i) => <span key={i}>{i * 10}s</span>)}</div>
        <div className="mk-tracks">
          {MOCK_TRACKS.map((tr) => (
            <div key={tr.label} className="mk-track">
              <em>{tr.label}</em>
              <div className="mk-lane">
                {tr.clips.map((c, i) => (
                  <div key={i} className="mk-clip" style={{ left: `${c.l}%`, width: `${c.w}%`, background: c.c }}>{c.t}</div>
                ))}
              </div>
            </div>
          ))}
          <div className="mk-playwrap"><div className="mk-playhead" /></div>
        </div>
      </div>
    </div>
  );
};

/* ============================ PAGE ============================ */
type SplitWordsProps = { text: string; className?: string };
const SplitWords = ({ text, className }: SplitWordsProps) => (
  <span className={className}>
    {text.split(" ").map((w, i) => (
      <span key={i} className="word-mask"><span className="word">{w}&nbsp;</span></span>
    ))}
  </span>
);

export default function KlipCutLanding() {
  const root = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [toast, setToast] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const magHero = useMagnetic<HTMLAnchorElement>(0.3);
  const magMain = useMagnetic<HTMLAnchorElement>(0.25);
  const magNav = useMagnetic<HTMLAnchorElement>(0.2);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = cursor.current;
    if (!el) return;
    const xTo = gsap.quickTo(el, "x", { duration: 0.35, ease: "power3" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.35, ease: "power3" });
    const move = (e: PointerEvent) => {
      xTo(e.clientX);
      yTo(e.clientY);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  useEffect(() => {
    const mm = gsap.matchMedia();
    const ctx = gsap.context(() => {
      // Faster hero — less “blank then pop” delay
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(".hero .word", { yPercent: 110, duration: 0.75, stagger: 0.05 })
        .from(".hero-badge", { y: 12, opacity: 0, duration: 0.45 }, 0)
        .from(".hero-sub", { y: 18, opacity: 0, duration: 0.55 }, 0.12)
        .from(".hero-cta > *", { y: 16, opacity: 0, duration: 0.5, stagger: 0.06 }, 0.2)
        .from(".hero-meta span", { opacity: 0, y: 8, stagger: 0.04, duration: 0.4 }, 0.35)
        .from(".nav", { y: -40, opacity: 0, duration: 0.55 }, 0);

      gsap.fromTo(
        ".mock-wrap",
        { rotateX: 12, y: 48, opacity: 0.5, scale: 0.97 },
        {
          rotateX: 0,
          y: 0,
          opacity: 1,
          scale: 1,
          ease: "none",
          scrollTrigger: {
            trigger: ".mock-section",
            start: "top 85%",
            end: "top 35%",
            scrub: 0.6,
          },
        },
      );
      gsap.to(".mock-glow", {
        opacity: 1,
        scale: 1.15,
        ease: "none",
        scrollTrigger: {
          trigger: ".mock-section",
          start: "top 80%",
          end: "bottom 45%",
          scrub: true,
        },
      });

      gsap.set(".reveal", { opacity: 0, y: 36 });
      ScrollTrigger.batch(".reveal", {
        start: "top 90%",
        once: true,
        onEnter: (els) =>
          gsap.to(els, {
            opacity: 1,
            y: 0,
            duration: 0.7,
            stagger: 0.08,
            ease: "power3.out",
            overwrite: true,
          }),
      });

      gsap.utils.toArray<HTMLElement>(".sec-title").forEach((el) => {
        gsap.from(el.querySelectorAll(".word"), {
          yPercent: 110,
          duration: 0.75,
          stagger: 0.04,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
        });
      });

      gsap.utils.toArray<HTMLElement>(".count").forEach((el) => {
        const target = Number(el.dataset.v || 0);
        const obj = { v: 0 };
        ScrollTrigger.create({
          trigger: el,
          start: "top 92%",
          once: true,
          onEnter: () =>
            gsap.to(obj, {
              v: target,
              duration: 1.6,
              ease: "power2.out",
              onUpdate: () => {
                el.textContent = String(Math.round(obj.v));
              },
            }),
        });
      });

      // Constant-speed marquee (no per-scroll velocity tweens — those caused jank)
      gsap.to(".marquee-track", {
        xPercent: -50,
        ease: "none",
        repeat: -1,
        duration: 32,
      });

      gsap.utils.toArray<HTMLElement>(".orb").forEach((o, i) => {
        gsap.to(o, {
          yPercent: (i % 2 ? -1 : 1) * 28,
          ease: "none",
          scrollTrigger: { trigger: o.parentElement, scrub: true },
        });
      });

      gsap.from(".dl-card", {
        scale: 0.96,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
        scrollTrigger: { trigger: ".dl-card", start: "top 82%", once: true },
      });
    }, root);

    // Horizontal scroll steps (desktop)
    mm.add("(min-width: 900px)", () => {
      const track = root.current?.querySelector<HTMLElement>(".steps-track");
      const pin = root.current?.querySelector<HTMLElement>(".steps-pin");
      if (!track || !pin) return;
      const dist = () => track.scrollWidth - window.innerWidth + 120;
      gsap.to(track, {
        x: () => -dist(), ease: "none",
        scrollTrigger: { trigger: pin, start: "top top", end: () => "+=" + dist(), pin: true, scrub: 1, invalidateOnRefresh: true },
      });
      gsap.to(".steps-progress i", {
        scaleX: 1, ease: "none", transformOrigin: "left center",
        scrollTrigger: { trigger: pin, start: "top top", end: () => "+=" + dist(), scrub: true, invalidateOnRefresh: true },
      });
    });

    return () => { ctx.revert(); mm.revert(); };
  }, []);

  const spotlight = (e: ReactMouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  const tiltMove = (e: ReactMouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    gsap.to(el, {
      rotateY: px * 6,
      rotateX: -py * 6,
      transformPerspective: 900,
      duration: 0.45,
      ease: "power2.out",
      overwrite: "auto",
    });
  };
  const tiltLeave = (e: ReactMouseEvent<HTMLElement>) => {
    gsap.to(e.currentTarget, {
      rotateY: 0,
      rotateX: 0,
      duration: 0.6,
      ease: "power3.out",
      overwrite: "auto",
    });
  };

  const onDownload = () => {
    setToast(true);
    window.setTimeout(() => setToast(false), 4200);
  };

  const scrollTo = (id: string) => (e: ReactMouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - 20,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="cl" ref={root}>
      <Suspense fallback={<div className="scene3d scene3d-placeholder" aria-hidden />}>
        <Scene3D />
      </Suspense>
      <div className="vignette" />
      <div className="grain" />
      <div className="cursor-glow" ref={cursor} />

      {/* NAV */}
      <header className={`nav ${scrolled ? "scrolled" : ""}`}>
        <a href="#top" className="nav-logo" onClick={scrollTo("top")}><Logo /></a>
        <nav className="nav-links">
          <a href="#features" onClick={scrollTo("features")}>Features</a>
          <a href="#workflow" onClick={scrollTo("workflow")}>Workflow</a>
          <a href="#download" onClick={scrollTo("download")}>Download</a>
          <a href="#faq" onClick={scrollTo("faq")}>FAQ</a>
        </nav>
        <a ref={magNav} href={APP.downloadUrl} download={APP.fileName} className="btn btn-sm" onClick={onDownload}>
          <Icon name="download" size={16} /> Get .exe
        </a>
      </header>

      {/* HERO */}
      <section className="hero" id="top">
        <div className="hero-inner">
          <div className="hero-badge"><i /> v{APP.version} · Video Editor for Windows</div>
          <h1 className="hero-title">
            <SplitWords text="Cut fast." />
            <br />
            <SplitWords text="Edit beautifully." />
            <br />
            <SplitWords text="Shine." className="grad" />
          </h1>
          <p className="hero-sub">
            {APP.name} is a lightweight, fast, powerful video editor — multi-layer timeline, real-time effects, and GPU-accelerated render.
            Everything you need to turn raw footage into a finished piece.
          </p>
          <div className="hero-cta">
            <a ref={magHero} href={APP.downloadUrl} download={APP.fileName} className="btn btn-lg" onClick={onDownload}>
              <Icon name="windows" size={20} fill /> Download for Windows
            </a>
            <a href="#features" className="btn btn-ghost btn-lg" onClick={scrollTo("features")}>Explore features</a>
          </div>
          <div className="hero-meta">
            <span>{APP.os}</span><span>•</span><span>{APP.size}</span><span>•</span><span>Version {APP.version}</span>
          </div>
        </div>
        <div className="scroll-hint"><div /></div>
      </section>

      {/* MARQUEE */}
      <div className="marquee">
        <div className="marquee-track">
          {[...MARQUEE, ...MARQUEE, ...MARQUEE, ...MARQUEE].map((m, i) => (
            <span key={i}>{m}<b>✦</b></span>
          ))}
        </div>
      </div>

      {/* MOCKUP */}
      <section className="mock-section">
        <div className="mock-glow" />
        <div className="mock-wrap"><EditorMock /></div>
      </section>

      {/* STATS */}
      <section className="stats">
        {STATS.map((s) => (
          <div className="stat reveal" key={s.label}>
            <div className="stat-num">{s.prefix}<span className="count" data-v={s.v}>0</span>{s.suffix}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </section>

      {/* FEATURES */}
      <section className="sec" id="features">
        <div className="orb o1" />
        <div className="sec-head">
          <div className="eyebrow reveal">Features</div>
          <h2 className="sec-title"><SplitWords text="Every tool you need," /><br /><SplitWords text="nothing you don't." className="grad" /></h2>
        </div>
        <div className="bento">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className={`card reveal ${f.wide ? "wide" : ""}`}
              onMouseMove={(e) => { spotlight(e); tiltMove(e); }}
              onMouseLeave={tiltLeave}
            >
              <div className="card-icon"><Icon name={f.icon} /></div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* WORKFLOW — horizontal pinned */}
      <section className="steps" id="workflow">
        <div className="steps-pin">
          <div className="steps-head">
            <div className="eyebrow">Workflow</div>
            <h2 className="sec-title"><SplitWords text="From raw footage" /><br /><SplitWords text="to final export." className="grad" /></h2>
            <div className="steps-progress"><i /></div>
          </div>
          <div className="steps-track">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <div className="step-n">{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
                <div className="step-bars">{Array.from({ length: 14 }).map((_, i) => <i key={i} style={{ height: `${20 + ((i * 37 + s.n.charCodeAt(1) * 11) % 70)}%` }} />)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DOWNLOAD */}
      <section className="sec dl" id="download">
        <div className="orb o2" />
        <div className="dl-card" onMouseMove={spotlight}>
          <div className="dl-left">
            <div className="eyebrow">Ready?</div>
            <h2 className="dl-title">Download {APP.name} and start editing today.</h2>
            <p>A lightweight installer. No account required. Install and go.</p>
            <a ref={magMain} href={APP.downloadUrl} download={APP.fileName} className="btn btn-xl" onClick={onDownload}>
              <Icon name="download" size={22} /> Download {APP.fileName}
            </a>
            <div className="dl-note">{APP.os} · {APP.size} · v{APP.version}</div>
          </div>
          <div className="dl-right">
            <h4>System requirements</h4>
            <ul>
              <li><span>OS</span><b>Windows 10 / 11 (64-bit)</b></li>
              <li><span>CPU</span><b>4 cores or more</b></li>
              <li><span>RAM</span><b>8 GB (16 GB recommended)</b></li>
              <li><span>GPU</span><b>DirectX 11+</b></li>
              <li><span>Disk</span><b>500 MB free</b></li>
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="sec faq" id="faq">
        <div className="sec-head">
          <div className="eyebrow reveal">FAQ</div>
          <h2 className="sec-title"><SplitWords text="Frequently asked questions" /></h2>
        </div>
        <div className="faq-list">
          {FAQ.map((f, i) => (
            <div className={`faq-item reveal ${openFaq === i ? "open" : ""}`} key={f.q}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i}>
                <span>{f.q}</span>
                <i><Icon name="plus" size={18} /></i>
              </button>
              <div className="faq-a"><div><p>{f.a}</p></div></div>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <Logo />
        <div className="foot-mid">© {new Date().getFullYear()} {APP.name}. All rights reserved.</div>
        <a href={`mailto:${APP.contact}`}>{APP.contact}</a>
      </footer>

      <div className={`toast ${toast ? "show" : ""}`}>
        <Icon name="download" size={18} /> Starting download of {APP.fileName}…
      </div>
    </div>
  );
}
