import { useEffect, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Full-bleed WebGL timeline backdrop.
 * Looks like the original; runtime is throttled (shared mats, lower res, pause off-screen).
 */
export default function Scene3D() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const prefersReduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const isMobile = W() < 768;
    // Render at lower internal res, stretch via CSS — big FPS win, still looks sharp
    const SCALE = isMobile ? 0.55 : window.devicePixelRatio > 1.5 ? 0.65 : 0.8;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x070a10, 0.038);

    const camera = new THREE.PerspectiveCamera(55, W() / H(), 0.1, 200);
    camera.position.set(0, 1, 15);

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
      stencil: false,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(Math.floor(W() * SCALE), Math.floor(H() * SCALE), false);
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    mount.appendChild(canvas);

    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const l1 = new THREE.PointLight(0x5b9fff, 55, 40);
    l1.position.set(-8, 5, 8);
    scene.add(l1);
    const l2 = new THREE.PointLight(0x6b7cff, 70, 40);
    l2.position.set(8, -3, 8);
    scene.add(l2);
    const l3 = new THREE.PointLight(0xd57a9c, 40, 40);
    l3.position.set(0, 6, -4);
    scene.add(l3);

    const group = new THREE.Group();
    scene.add(group);
    const palette = [0x5b9fff, 0x6b7cff, 0xd57a9c, 0x3db8c9, 0x7a9ec9];
    // One shared material per color — avoids hundreds of unique GPU programs
    const mats = palette.map(
      (color) =>
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.32,
          metalness: 0.35,
          roughness: 0.35,
          transparent: true,
          opacity: 0.92,
        }),
    );
    const clips: { mesh: THREE.Mesh; base: number; phase: number; matI: number }[] = [];
    const tracks = isMobile ? 4 : 6;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    for (let t = 0; t < tracks; t++) {
      let x = -16 + rand(0, 2);
      while (x < 16) {
        const w = rand(1.2, 4.2);
        const matI = Math.floor(Math.random() * mats.length);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, 1), mats[matI]!);
        mesh.position.set(x + w / 2, (t - tracks / 2) * 0.85, rand(-0.4, 0.4));
        group.add(mesh);
        clips.push({ mesh, base: mesh.position.z, phase: rand(0, Math.PI * 2), matI });
        x += w + rand(0.15, 1.1);
      }
    }
    group.rotation.set(0.35, -0.55, 0.05);

    const head = new THREE.Group();
    head.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.06, tracks * 0.9 + 1.5, 1.6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      ),
      new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, tracks * 0.9 + 2.5),
        new THREE.MeshBasicMaterial({
          color: 0x5b9fff,
          transparent: true,
          opacity: 0.12,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    group.add(head);

    const N = isMobile ? 350 : 700;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rand(-40, 40);
      pos[i * 3 + 1] = rand(-25, 25);
      pos[i * 3 + 2] = rand(-40, 14);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        size: 0.055,
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    scene.add(points);

    const ring = new THREE.Mesh(
      new THREE.TorusKnotGeometry(3, 0.35, 64, 8),
      new THREE.MeshBasicMaterial({
        color: 0x6b7cff,
        wireframe: true,
        transparent: true,
        opacity: 0.14,
      }),
    );
    ring.position.set(9, -4, -14);
    scene.add(ring);

    if (!prefersReduced) {
      const introTl = gsap.timeline();
      clips.forEach(({ mesh }, i) => {
        const sx = mesh.scale.x;
        mesh.scale.x = 0.0001;
        introTl.to(
          mesh.scale,
          { x: sx, duration: 1.0, ease: "power3.out" },
          0.08 + (i % 24) * 0.02,
        );
      });
      introTl.from(camera.position, { z: 30, y: 6, duration: 2.4, ease: "power3.out" }, 0);
    }

    const state = { camZ: 15, camY: 1, rotY: -0.55, rotX: 0.35, gx: 0 };
    const scrollTween = gsap.timeline({
      scrollTrigger: {
        trigger: document.body,
        start: "top top",
        end: "bottom bottom",
        scrub: 1.2,
      },
    });
    scrollTween
      .to(state, { camZ: 9, camY: 0, rotY: 0.15, rotX: 0.1, gx: 0, ease: "none", duration: 1 })
      .to(state, { camZ: 12, camY: -2, rotY: 0.6, rotX: 0.5, gx: -2, ease: "none", duration: 1 })
      .to(state, { camZ: 7, camY: 1, rotY: -0.2, rotX: 0.05, gx: 0, ease: "none", duration: 1 });

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      mouse.tx = (e.clientX / W()) * 2 - 1;
      mouse.ty = (e.clientY / H()) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const onResize = () => {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(Math.floor(W() * SCALE), Math.floor(H() * SCALE), false);
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    let running = true;
    let tabVisible = document.visibilityState === "visible";
    // Keep animating through hero + mock; pause deeper in the page
    let inFocus = true;
    const FOCUS_Y = () => H() * 2.8;

    const kick = () => {
      if (running && tabVisible && inFocus && !raf) raf = requestAnimationFrame(loop);
    };

    const onScroll = () => {
      inFocus = window.scrollY < FOCUS_Y();
      kick();
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const onVis = () => {
      tabVisible = document.visibilityState === "visible";
      kick();
    };
    document.addEventListener("visibilitychange", onVis);

    const clock = new THREE.Clock();
    let frame = 0;
    // Pulse shared materials globally (cheap) instead of per-clip emissive writes
    const matPulse = mats.map(() => 0.32);

    const loop = () => {
      raf = 0;
      if (!running || !tabVisible || !inFocus) return;

      frame += 1;
      const t = clock.getElapsedTime();
      mouse.x += (mouse.tx - mouse.x) * 0.05;
      mouse.y += (mouse.ty - mouse.y) * 0.05;

      camera.position.z += (state.camZ - camera.position.z) * 0.06;
      camera.position.y += (state.camY - mouse.y * 0.8 - camera.position.y) * 0.06;
      camera.position.x += (mouse.x * 1.2 - camera.position.x) * 0.06;
      camera.lookAt(state.gx, 0, 0);

      group.rotation.y += (state.rotY + mouse.x * 0.12 - group.rotation.y) * 0.06;
      group.rotation.x += (state.rotX + mouse.y * 0.08 - group.rotation.x) * 0.06;

      // Alternate clip z-updates across frames
      const start = frame % 2;
      for (let i = start; i < clips.length; i += 2) {
        const c = clips[i]!;
        c.mesh.position.z = c.base + Math.sin(t * 0.9 + c.phase) * 0.25;
      }

      if (frame % 2 === 0) {
        for (let i = 0; i < mats.length; i++) {
          matPulse[i] = 0.26 + (Math.sin(t * 1.4 + i * 1.7) * 0.5 + 0.5) * 0.22;
          mats[i]!.emissiveIntensity = matPulse[i]!;
        }
      }

      head.position.x = ((t * 3.2) % 34) - 17;
      points.rotation.y = t * 0.012;
      points.rotation.x = t * 0.006;
      ring.rotation.x = t * 0.15;
      ring.rotation.y = t * 0.2;

      l1.position.x = Math.sin(t * 0.6) * 10;
      l2.position.y = Math.cos(t * 0.5) * 6;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVis);
      scrollTween.scrollTrigger?.kill();
      scrollTween.kill();
      gsap.killTweensOf(camera.position);
      clips.forEach(({ mesh }) => gsap.killTweensOf(mesh.scale));
      mats.forEach((m) => m.dispose());
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Points)) return;
        o.geometry?.dispose();
        const mat = o.material;
        // Shared clip mats already disposed above
        if (mats.includes(mat as THREE.MeshStandardMaterial)) return;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      if (canvas.parentNode === mount) mount.removeChild(canvas);
    };
  }, []);

  return <div ref={mountRef} className="scene3d" aria-hidden />;
}
