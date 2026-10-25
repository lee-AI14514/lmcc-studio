import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { RecoilRoot } from "recoil";

const root = ReactDOM.createRoot(document.getElementById("root"));

const renderApp = () => {
  root.render(
    <React.StrictMode>
      <RecoilRoot>
        <App />
      </RecoilRoot>
    </React.StrictMode>
  );
};

// Make sure the bundled UI + mono fonts are ready before Monaco measures
// character widths, otherwise the first cursor position can be off.
const fontsReady =
  document.fonts && document.fonts.load
    ? Promise.all([
        document.fonts.load('13px "Inter"'),
        document.fonts.load('13px "JetBrains Mono"'),
      ])
        .then(() => document.fonts.ready)
        .catch(() => {})
    : Promise.resolve();

fontsReady.then(renderApp);
