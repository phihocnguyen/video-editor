import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";
import "./styles/global.css";

// No StrictMode: its play→cleanup→play double-invoke was pausing preview
// videos on the first Play click (tiny glitch, needed 2–3 presses).
createRoot(document.getElementById("root") as HTMLElement).render(<App />);
