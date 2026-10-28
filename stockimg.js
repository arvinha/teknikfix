// Drawn example images for shop listings that have no photos yet: front and back of the device type,
// with the camera layout of the model family. The page always labels them "Eksempelbillede".

const BODY = "#3b3f46";
const EDGE = "#8d929b";

function lens(x, y, r) {
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="#1b1d21" stroke="#5c616a" stroke-width="${r * 0.18}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.55}" fill="#0b0c0e"/>` +
    `<circle cx="${x - r * 0.22}" cy="${y - r * 0.22}" r="${r * 0.16}" fill="#6f7c99" opacity="0.8"/>`
  );
}

function flash(x, y, r) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#e9e3cf" stroke="#b9b3a0" stroke-width="2"/>`;
}

function iphoneCameras(id, x, y) {
  if (/^iphone-(se|16e|x-xs-xr)$/.test(id)) return lens(x + 34, y + 34, 15) + flash(x + 34, y + 72, 6);
  if (id === "iphone-air") return `<rect x="${x - 8}" y="${y}" width="196" height="58" rx="29" fill="#4a4f57"/>` + lens(x + 28, y + 29, 17) + flash(x + 160, y + 29, 6);
  if (/^iphone-(17-pro|16-pro|15-pro|14-pro|13-pro|12-pro|11-pro)/.test(id)) {
    return (
      `<rect x="${x}" y="${y}" width="104" height="104" rx="26" fill="#4a4f57"/>` +
      lens(x + 30, y + 30, 19) + lens(x + 30, y + 76, 19) + lens(x + 74, y + 53, 19) + flash(x + 80, y + 20, 6)
    );
  }
  if (/^iphone-(17|16|16-plus)$/.test(id)) {
    return `<rect x="${x}" y="${y}" width="56" height="106" rx="28" fill="#4a4f57"/>` + lens(x + 28, y + 28, 18) + lens(x + 28, y + 78, 18) + flash(x + 74, y + 52, 6);
  }
  const diagonal = /^iphone-(13|13-mini|14|14-plus|15|15-plus)$/.test(id);
  return (
    `<rect x="${x}" y="${y}" width="96" height="96" rx="24" fill="#4a4f57"/>` +
    (diagonal ? lens(x + 28, y + 28, 18) + lens(x + 68, y + 68, 18) : lens(x + 28, y + 28, 18) + lens(x + 28, y + 68, 18)) +
    flash(x + 72, y + 24, 6)
  );
}

function androidCameras(id, x, y, w) {
  if (/^pixel/.test(id)) {
    const pill = /^pixel-(9|10)/.test(id);
    return pill
      ? `<rect x="${x + 20}" y="${y}" width="${w - 80}" height="56" rx="28" fill="#4a4f57"/>` + lens(x + 54, y + 28, 16) + lens(x + 96, y + 28, 16) + flash(x + w - 92, y + 28, 6)
      : `<rect x="${x - 18}" y="${y}" width="${w + 0}" height="62" rx="10" fill="#1f2226"/>` + lens(x + 40, y + 31, 17) + lens(x + 84, y + 31, 17) + flash(x + w - 70, y + 31, 6);
  }
  if (/^galaxy-z-flip/.test(id)) return `<rect x="${x}" y="${y}" width="${w - 36}" height="120" rx="18" fill="#15171a"/>` + lens(x + 30, y + 40, 16) + lens(x + 30, y + 84, 16);
  const count = /ultra/.test(id) ? 4 : 3;
  let out = "";
  for (let i = 0; i < count; i += 1) out += lens(x + 28, y + 26 + i * 44, 17);
  return out + flash(x + 66, y + 26, 6);
}

function phone(id) {
  const apple = /^iphone/.test(id);
  const se = id === "iphone-se";
  const notch = /^iphone-(x-xs-xr|11|12|13)/.test(id) || /^iphone-(14|14-plus)$/.test(id) || id === "iphone-16e";
  const front =
    `<g transform="translate(380 120) rotate(6)">` +
    `<rect x="0" y="0" width="280" height="560" rx="${se ? 40 : 48}" fill="${BODY}" stroke="${EDGE}" stroke-width="6"/>` +
    (se
      ? `<rect x="18" y="80" width="244" height="400" rx="4" fill="url(#screen)"/><circle cx="140" cy="522" r="24" fill="none" stroke="${EDGE}" stroke-width="4"/><rect x="110" y="38" width="60" height="8" rx="4" fill="#23262b"/>`
      : `<rect x="12" y="12" width="256" height="536" rx="38" fill="url(#screen)"/>` +
        (apple
          ? notch
            ? `<path d="M80 12h120v18a14 14 0 0 1-14 14H94a14 14 0 0 1-14-14z" fill="#0b0c0e"/>`
            : `<rect x="100" y="26" width="80" height="24" rx="12" fill="#0b0c0e"/>`
          : `<circle cx="140" cy="36" r="9" fill="#0b0c0e"/>`)) +
    `<path d="M40 70 L200 70 L60 420 Z" fill="#ffffff" opacity="0.06"/>` +
    `</g>`;
  const back =
    `<g transform="translate(150 150) rotate(-6)">` +
    `<rect x="0" y="0" width="270" height="540" rx="46" fill="${BODY}" stroke="${EDGE}" stroke-width="6"/>` +
    `<rect x="6" y="6" width="258" height="528" rx="40" fill="url(#back)"/>` +
    (apple ? iphoneCameras(id, 26, 26) : androidCameras(id, 24, 30, 230)) +
    `</g>`;
  return back + front;
}

function tablet() {
  return (
    `<g transform="translate(90 120) rotate(-5)">` +
    `<rect x="0" y="0" width="360" height="500" rx="30" fill="${BODY}" stroke="${EDGE}" stroke-width="6"/>` +
    `<rect x="6" y="6" width="348" height="488" rx="26" fill="url(#back)"/>` +
    `<rect x="22" y="22" width="56" height="56" rx="16" fill="#4a4f57"/>` +
    lens(50, 50, 16) +
    `</g>` +
    `<g transform="translate(320 170) rotate(4)">` +
    `<rect x="0" y="0" width="380" height="520" rx="32" fill="${BODY}" stroke="${EDGE}" stroke-width="6"/>` +
    `<rect x="18" y="18" width="344" height="484" rx="18" fill="url(#screen)"/>` +
    `<circle cx="190" cy="10" r="4" fill="#0b0c0e"/>` +
    `<path d="M60 60 L260 60 L80 400 Z" fill="#ffffff" opacity="0.06"/>` +
    `</g>`
  );
}

function computer(id) {
  const imac = id === "imac";
  if (imac) {
    return (
      `<rect x="110" y="120" width="580" height="400" rx="22" fill="#d5d8dd" stroke="${EDGE}" stroke-width="5"/>` +
      `<rect x="126" y="136" width="548" height="330" rx="8" fill="url(#screen)"/>` +
      `<path d="M350 520h100l26 150H324z" fill="#c4c8ce"/>` +
      `<rect x="290" y="664" width="220" height="14" rx="7" fill="#b3b8bf"/>`
    );
  }
  return (
    `<path d="M160 190a20 20 0 0 1 20-20h440a20 20 0 0 1 20 20v300H160z" fill="${BODY}" stroke="${EDGE}" stroke-width="5"/>` +
    `<rect x="176" y="186" width="448" height="290" rx="6" fill="url(#screen)"/>` +
    `<path d="M80 492h640l-30 42a24 24 0 0 1-20 10H130a24 24 0 0 1-20-10z" fill="#9aa0a8"/>` +
    `<rect x="350" y="492" width="100" height="10" rx="5" fill="#7c828b"/>`
  );
}

function svg(modelId, device) {
  const id = String(modelId || "");
  const art = device === "tablet" ? tablet() : device === "computer" ? computer(id) : phone(id);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">` +
    `<defs>` +
    `<linearGradient id="screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d3b33"/><stop offset="0.55" stop-color="#14231f"/><stop offset="1" stop-color="#0c1311"/></linearGradient>` +
    `<linearGradient id="back" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#454a52"/><stop offset="1" stop-color="#30333a"/></linearGradient>` +
    `<radialGradient id="floor" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.16"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<rect width="800" height="800" fill="#ffffff"/>` +
    `<ellipse cx="400" cy="720" rx="300" ry="34" fill="url(#floor)"/>` +
    art +
    `</svg>`
  );
}

module.exports = { svg };
