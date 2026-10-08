import React from "react";
import { createRoot } from "react-dom/client";
import App from "./v2/App.jsx";
import { installNativeHttp } from "./lib/http.js";
installNativeHttp()
  .catch(() => {})
  .then(() =>
    createRoot(document.getElementById("root")).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
