// Adds an "Open Valis Studio" entry to the ComfyUI editor so the studio is one click away.
import { app } from "../../scripts/app.js";

app.registerExtension({
  name: "valis.studio.button",
  async setup() {
    const open = () => window.open("/valis", "_blank");
    try {
      if (app.menu?.settingsGroup) {
        const { ComfyButton } = await import("../../scripts/ui/components/button.js");
        const b = new ComfyButton({ icon: "movie-open", tooltip: "Open Valis Studio", content: "Valis", action: open });
        app.menu.settingsGroup.append(b);
        return;
      }
    } catch (e) { /* fall through to the classic menu */ }
    const btn = document.createElement("button");
    btn.textContent = "Valis Studio";
    btn.onclick = open;
    document.querySelector(".comfy-menu")?.append(btn);
  },
});
