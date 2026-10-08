
(function () {
  const NUM = IMAGE_DATA.length;          // 23 photos from the gallery
  const GAP_PX = 80;                      // visible gap between cards, in screen px
  const RING_PX = 0.57;                   // ring radius as share of the smaller viewport edge
  const ROY = 0.16;                       // auto-rotation speed (rad/s), only in ring mode
  const TILT = 0.07;                      // mouse tilt amplitude
  const OVERLAY = 0.2;                    // white overlay on every card by default
  const UNFOLD_DIST = 10;                 // scroll units needed to fully unfold the tape
  const RISE_DIST = 18;                   // экран 2: чёрная шторка (BG) и текст поднимаются
  const SHOW_DIST = 6;                    // хвост заливки текста после подъёма
  const CURTAIN_START = 0;                // шторка стартует с самого начала, кольцо разворачивается под ней (наслоение)
  const STACK_P0 = 21;                    // экран 3: шторка уехала (~20.7) — дальше скролл = листание событий
  const POSTER_DIST = 1;                  // порог скролла после шторки: лишнее колесо = 1 смена

  // --- corridor mode ---
  let corridorMode = false;
  let corridorBlend = 0;              // 0 = ring, 1 = corridor
  let corridorBlendTarget = 0;
  let corridorDepth = 0;
  let corridorScroll = 0;
  let corridorScrollTarget = 0;
  const CORRIDOR_CARD_GAP = 4;
  const CORRIDOR_SIDE_SPREAD = 2.3;
  const CORRIDOR_CAM_Y = 1.7;
  const CORRIDOR_LOOP = NUM * CORRIDOR_CARD_GAP;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfbfcfa);

  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 1.5, 14);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);

  const loader = new THREE.TextureLoader();
  const ring = new THREE.Group();
  scene.add(ring);

  // corridor lights (hidden until corridor mode)
  const corridorLights = [];
  const CORRIDOR_LIGHT_STEP = 8;
  const CORRIDOR_LIGHT_LOOP = 40;
  for (let i = 0; i < 20; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 26);
    scene.add(light);
    corridorLights.push({ light, base: -(i + 1) * CORRIDOR_LIGHT_STEP });
  }
  const corridorFog = new THREE.FogExp2(0x050505, 0.05);

  const cards = [];   // { group, wrap, mesh, overlay, ang, aspect, done, lean, off, lift, ovT }
  let radius = 0;
  let spacingUnit = 0;                    // card pitch on the tape (world units)
  let tapeSpan = 0;                       // tape length in world units, set in layout()

  // world units per screen pixel at the plane of the ring
  const unitPerPx = () => (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / innerHeight;

  // ring radius, card width and tape pitch all computed in screen pixels so the
  // whole ring fits the window and the gap stays ~GAP_PX
  function layout() {
    const upx = unitPerPx();
    const rPx = RING_PX * Math.min(innerWidth, innerHeight);
    radius = rPx * upx;
    const arcPx = (Math.PI * 2 * rPx) / NUM;
    const wPx = Math.max(60, arcPx - GAP_PX);
    const w = wPx * upx;
    spacingUnit = (arcPx + GAP_PX) * upx; // card pitch = card width + gap, keeps the same 80px
    tapeSpan = NUM * spacingUnit;

    cards.forEach(c => {
      c.mesh.scale.set(w, w * c.aspect, 1);
      c.overlay.scale.set(w, w * c.aspect, 1);
    });
  }
  function setAspect(c, aspect, force) {
    if (c.done && !force) return;
    c.aspect = aspect;
    c.done = true;
    layout();
  }

  for (let i = 0; i < NUM; i++) {
    const ang = (i / NUM) * Math.PI * 2;
    const tex = loader.load(IMAGE_DATA[i]);
    tex.encoding = THREE.sRGBEncoding;

    const group = new THREE.Group();
    ring.add(group);

    const wrap = new THREE.Group();       // "sticks" toward the cursor on hover
    group.add(wrap);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide })
    );
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: OVERLAY, side: THREE.DoubleSide })
    );
    wrap.add(mesh);
    wrap.add(overlay);

    const card = { group, wrap, mesh, overlay, ang, aspect: 1, done: false, lean: 0, off: 0, lift: 0, ovT: OVERLAY };
    cards.push(card);

    const im = tex.image;
    if (im && im.width) setAspect(card, im.height / im.width, true);
  }
  layout();

  // ---- hover via raycast, "stick" like in index.html ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hoverCard = null;

  function cardUnderPointer(e) {
    ndc.x = (e.clientX / innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    for (const hit of raycaster.intersectObjects(cards.map(c => c.mesh))) {
      return cards.find(c => c.mesh === hit.object);
    }
    return null;
  }
  window.addEventListener('mousemove', (e) => {
    hoverCard = cardUnderPointer(e);
  }, { passive: true });

  // mouse tilt: -1..1, smoothed
  let mx = 0, my = 0, smx = 0, smy = 0;
  window.addEventListener('mousemove', (e) => {
    mx = (e.clientX / innerWidth) * 2 - 1;
    my = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  // инерционная точка за курсором (белая, exclusion) — как Obys
  const cursorDot = document.getElementById('cursor-dot');
  let dmx = -9999, dmy = -9999, pmx = -9999, pmy = -9999;
  let dScale = 1, pScale = 1;
  let cursorVisible = false;

  window.addEventListener('mousemove', (e) => {
    pmx = e.clientX; pmy = e.clientY;
    if (!cursorVisible) {
      cursorVisible = true;
      cursorDot.classList.add('on');
      dmx = pmx; dmy = pmy;
    }
    // увеличиваем только при наведении на карточку карусели (hoverCard через raycast)
    pScale = hoverCard ? 3 : 1;
  }, { passive: true });
  document.addEventListener('mouseleave', () => {
    cursorVisible = false;
    cursorDot.classList.remove('on');
  });

  // ---- wheel: инерция колеса вЂ” дельты копим в скорость, скорость затухает ----
  const SCROLL_MAX = UNFOLD_DIST + RISE_DIST + NUM * 0.5;
  let scroll = 0, scrollV = 0;             // position + velocity (scroll units/s)
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (corridorMode) {
      corridorScrollTarget += e.deltaY * 0.032;
      if (corridorScrollTarget < 0) corridorScrollTarget = 0;
      if (corridorScrollTarget > 100000) corridorScrollTarget = 100000;
      return;
    }
    scrollV += e.deltaY * 0.022;            // копим дельты колеса в скорость
    scrollV *= 0.92;                       // мягкое гашение рывков
  }, { passive: false });

  // ---- фиста: галерея на фото2 (колесо = смена) ----
  const GALLERY_COUNT = 23;
  const WHEEL_STEP = 100;                       // один щелчок колеса (~100px) = 1 смена
  const galleryEl = document.querySelector('.curtain-photo');
  const galleryPhotoA = galleryEl ? galleryEl.querySelector('img:not(.cp-b)') : null;
  const galleryPhotoB = galleryEl ? galleryEl.querySelector('.cp-b') : null;
  const FADE_MS = 220;
  let fadeTimer = null;
  let pendingSrc = null;
  let activeImg = galleryPhotoA;               // какой слой сейчас видимый
  const swapPhoto = (src) => {
    if (!galleryPhotoA || !galleryPhotoB) return;
    if (fadeTimer) { pendingSrc = src; return; }      // во время фейда — отложим
    const hidden = activeImg === galleryPhotoA ? galleryPhotoB : galleryPhotoA;
    hidden.src = src;
    hidden.style.opacity = '1';                 // новая проявляется ПОВЕРХ старой
    fadeTimer = setTimeout(() => {
      activeImg.src = src;                      // старый снизу дополняется до той же
      hidden.style.opacity = '0';               // старый виден, пустоты нет
      fadeTimer = null;
      if (pendingSrc) { const p = pendingSrc; pendingSrc = null; swapPhoto(p); }
    }, FADE_MS);
  };
  const galleryCache = [];
  for (let gi = 1; gi <= GALLERY_COUNT; gi++) {
    const im = new Image();
    im.src = `gallery/${gi}.jpg`;
    galleryCache.push(im);
  }
  let galleryIndex = 0;                        // 0 = исходное Event.png, дальше галерея
  let wheelAcc = 0;
  const galleryFiles = [];
  for (let gi = 1; gi <= GALLERY_COUNT; gi++) galleryFiles.push(`gallery/${gi}.jpg`);
  const pickRandomGallery = (avoid) => {
    let n;
    do { n = 1 + Math.floor(Math.random() * GALLERY_COUNT); } while (n === avoid);
    return n;
  };
  window.addEventListener('wheel', (e) => {
    if (!galleryPhotoA) return;
    if (e.deltaY === 0) return;
    wheelAcc += Math.abs(e.deltaY);
    const steps = Math.floor(wheelAcc / WHEEL_STEP);
    if (steps < 1) return;
    wheelAcc = wheelAcc % WHEEL_STEP;
    for (let k = 0; k < steps; k++) {
      galleryIndex = pickRandomGallery(galleryIndex);      // рандомный следующий файл
    }
    swapPhoto(galleryFiles[galleryIndex - 1]);
  }, { passive: true });

  function centerPoster() {
    const hdr = document.querySelector('.site-header')?.offsetHeight || 0;
    if (stackEl) stackEl.style.top = `calc(50% + ${hdr / 2}px)`;
    const first = posters && posters[0];
    const dateSt = document.querySelector('.date');
    if (dateSt && first) {
      if (first.offsetHeight > 0) {
        const centerY = hdr / 2 + innerHeight / 2;
        const bottomY = centerY + first.offsetHeight / 2;
        dateSt.style.bottom = `${Math.max(0, innerHeight - bottomY)}px`;
      } else {
        dateSt.style.bottom = '60px';
      }
    }
  }

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    layout();
    centerPoster();
  });

  const logoEl = document.getElementById('logo');
  const taglineEl = document.getElementById('tagline');
  const yearEl = document.getElementById('year');
  const mainTitleEl = document.getElementById('main-title');

  // underline: left→right in, right→left out
  document.querySelectorAll('.site-nav ul a').forEach(a => {
    a.addEventListener('mouseenter', () => {
      a.classList.remove('hover-out');
      void a.offsetWidth;
      a.classList.add('hover-in');
    });
    a.addEventListener('mouseleave', () => {
      a.classList.remove('hover-in');
      void a.offsetWidth;
      a.classList.add('hover-out');
    });
  });

  // ---- debug: высоты экранов для теста (2 зоны: синяя + вторая) ----
  const debugEl = document.getElementById('debug');
  const dCursor = document.getElementById('d-cursor');
  const DBG_TOTAL = UNFOLD_DIST + RISE_DIST + NUM * 0.5;
  const dValue = document.getElementById('d-value');
  const DBG_MARKS = {
    0: '0',
    [UNFOLD_DIST]: String(UNFOLD_DIST),
    [UNFOLD_DIST + RISE_DIST]: String(UNFOLD_DIST + RISE_DIST),
      };
  function addMark(at, label) {
    const m = document.createElement('div');
    m.className = 'd-mark';
    m.textContent = label;
    m.style.left = (at / DBG_TOTAL * 100).toFixed(2) + '%';
    debugEl.appendChild(m);
  }
  (function buildSegs() {
    const segs = [
      ['d-ring',   0, UNFOLD_DIST],
      ['d-curtain', UNFOLD_DIST, RISE_DIST],
          ];
    for (const [cls, from, width] of segs) {
      const s = document.createElement('div');
      s.className = 'd-seg ' + cls;
      s.style.left = (from / DBG_TOTAL * 100).toFixed(2) + '%';
      s.style.width = (width / DBG_TOTAL * 100).toFixed(2) + '%';
      debugEl.appendChild(s);
    }
    for (const at in DBG_MARKS) addMark(+at, DBG_MARKS[at]);
  })();
  function updateDebug() {
    const pct = Math.min(1, scroll / DBG_TOTAL);
    dCursor.style.left = (pct * 100).toFixed(2) + '%';
    const rx = (ring.rotation.x * 180 / Math.PI).toFixed(2);
    const rz = (ring.rotation.z * 180 / Math.PI).toFixed(2);
    dValue.textContent = `scroll=${scroll.toFixed(1)}  smx=${smx.toFixed(2)} smy=${smy.toFixed(2)}  rotX=${rx}° rotZ=${rz}°  mx=${mx.toFixed(2)} my=${my.toFixed(2)}`;
  }

  // ---- экран 2: шторка с текстом миссии ----
  const curtainEl = document.getElementById('curtain');
  const curtainText = document.getElementById('curtain-text');
  const whiteFillEl = document.getElementById('white-fill');
  const headerWhite = document.querySelector('.header-white');
  const headerDark = document.querySelector('.header-dark');
  // ---- афиша-стопка (экран 3): постера, ближний в начале массива ----
  const stackEl = document.getElementById('stack');
  const posters = Array.from(stackEl.querySelectorAll('.poster'));  // [0] = первое событие
  centerPoster();
  const dateEl = document.querySelector('.date');
  const eventTitle = document.querySelector('.event-title');
  const eventInfo = document.querySelector('.event-info');
  let dateShown = false;   // реально ли дата сейчас показана (переключаем только по порогу)
  let titleShown = false;  // реально ли заголовок сейчас показан

  // ---- Данные событий (слайдер экрана 3) ----
  const EVENTS = [
    {
      img: 'Afisha1.jpg',
      date: '12/02 — 31/07',
      title: ['«Фестиваль', 'позитивного', 'идейного искусства»'],
      format: 'Выставка + встреча с художниками'
    },
    {
      img: 'Afisha2.jpg',
      date: '08/08 — 31/12',
      title: ['«Выставка', '+', 'перфоманс»'],
      format: 'Выставка, перфоманс, лекции'
    }
  ];
  let evPage = 0;                  // текущее событие слайдера
  let evTransition = null;         // {from, to, t} — анимация смены «прокрут-действие»
  const SLIDE_MS = 0.7;            // длительность падения карточки, с

  function applyEvent(i) {
    const ev = EVENTS[i] || EVENTS[0];
    const di = dateEl && dateEl.querySelector('.date-inner');
    if (di) di.textContent = ev.date;
    if (eventInfo) {
      const t = eventInfo.querySelector('.ei-title');
      if (t) t.innerHTML = ev.title.map((l, k) => `<span class="${k % 2 ? 'tn' : 'hn'}">${l}</span>`).join('<br>');
      const txt = eventInfo.querySelector('.ei-text');
      if (txt) txt.textContent = ev.format;
    }
  }
  applyEvent(0);
  // Разбиваем текст на слова (неразрывные пробелы не рвём вЂ” предлог едет со словом).
  const curtainWords = (() => {
    const words = [];
    const walker = document.createTreeWalker(curtainText, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parts = node.textContent.split(/([ \t\r\n]+)/);
      const frag = document.createDocumentFragment();
      for (const part of parts) {
        if (!part) continue;
        if (/^[ \t\r\n]+$/.test(part)) {
          frag.appendChild(document.createTextNode(' '));
        } else {
          const s = document.createElement('span');
          s.className = 'w';
          s.textContent = part;
          frag.appendChild(s);
          words.push(s);
        }
      }
      node.parentNode.replaceChild(frag, node);
    }
    return words;
  })();
  let curtainLines = [];
  function groupCurtainLines() {
    curtainLines = [];
    let cur = null;
    for (const w of curtainWords) {
      const top = w.offsetTop;
      if (!cur || Math.abs(top - cur.top) > 8) {
        cur = { top, words: [] };
        curtainLines.push(cur);
      }
      cur.words.push(w);
    }
  }
  groupCurtainLines();
  window.addEventListener('resize', groupCurtainLines);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(groupCurtainLines);

  let last = performance.now();
  let auto = 0;                            // auto rotation angle (ring mode only)

  // --- corridor enter / exit ---
  function enterCorridor() {
    if (corridorMode) return;
    corridorMode = true;
    corridorBlendTarget = 1;
    corridorScroll = 0;
    corridorScrollTarget = 0;
    corridorDepth = 0;
    scene.fog = corridorFog;
    scene.background = new THREE.Color(0x050505);
    for (const L of corridorLights) L.light.intensity = 0.55;
    document.querySelectorAll('.site-nav').forEach(n => n.classList.add('corridor'));
    document.body.classList.add('in-corridor');
  }
  function exitCorridor() {
    if (!corridorMode) return;
    corridorMode = false;
    corridorBlendTarget = 0;
    corridorScroll = 0;
    corridorScrollTarget = 0;
    corridorDepth = 0;
    scene.fog = null;
scene.background = new THREE.Color(0xfbfcfa);
    for (const L of corridorLights) L.light.intensity = 0;
    document.querySelectorAll('.site-nav').forEach(n => n.classList.remove('corridor'));
    document.body.classList.remove('in-corridor');
    scroll = 0;
    scrollV = 0;
  }

  // --- click: card → corridor, × → exit ---
  window.addEventListener('click', (e) => {
    if (e.target.closest('.close-btn')) { exitCorridor(); return; }
    if (corridorMode) return;
    if (scroll > 1) return;
    if (!hoverCard) return;
    enterCorridor();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && corridorMode) exitCorridor();
  });

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    smx += (mx - smx) * (1 - Math.exp(-dt * 4));
    smy += (my - smy) * (1 - Math.exp(-dt * 4));

    // инерция: скорость затухает, scroll интегрирует скорость (мягкий выкат)
    scrollV *= Math.exp(-dt * 2.2);          // плавный выкат
    scroll += scrollV * dt;
    if (scroll < 0) { scroll = 0; scrollV = 0; }
    if (scroll > SCROLL_MAX) { scroll = SCROLL_MAX; scrollV = 0; }

    // apply each photo's real proportions once its image has loaded
    for (const c of cards) {
      if (!c.done) {
        const im = c.mesh.material.map.image;
        if (im && im.width) setAspect(c, im.height / im.width);
      }
    }

    const u = Math.min(1, scroll / UNFOLD_DIST);          // 0 = ring, 1 = tape
    // лента не едет вбок на 2-м экране (скрыта шторкой) вЂ” не тратим работу
    const tapeX = scroll < UNFOLD_DIST ? 0 : Math.max(0, scroll - UNFOLD_DIST - RISE_DIST);
    auto += ROY * (1 - u) * dt * (hoverCard ? 0.3 : 1);

    // Лента разворачивается в синей зоне (0..UNFOLD_DIST) — там и рендерим её.
    // Как только лента развернута и стоит, тяжёлый WebGL-цикл выключаем — канвас
    // хранит готовый кадр, а скролл после 10 не грузится (нет "падения" скорости).
    const sceneFade = corridorBlend > 0.01 ? 1 : Math.max(0, Math.min(1, (UNFOLD_DIST - scroll) / 3));
    renderer.domElement.style.opacity = String(sceneFade);
    const sceneLive = sceneFade > 0.001 || corridorBlend > 0.001;

    // corridor blend smoothing
    corridorBlend += (corridorBlendTarget - corridorBlend) * (1 - Math.exp(-dt * 2.5));
    if (corridorMode) {
      corridorDepth += (corridorScrollTarget - corridorDepth) * (1 - Math.exp(-dt * 6));
    }
    // hide HTML overlays in corridor mode
    if (corridorBlend > 0.01) {
      curtainEl.style.opacity = '0';
      curtainEl.style.pointerEvents = 'none';
      stackEl.style.opacity = '0';
      stackEl.style.pointerEvents = 'none';
      if (dateEl) dateEl.style.display = 'none';
      if (eventTitle) eventTitle.style.display = 'none';
      if (eventInfo) eventInfo.style.display = 'none';
    } else {
      curtainEl.style.opacity = '';
      curtainEl.style.pointerEvents = 'none';
      stackEl.style.opacity = '';
      stackEl.style.pointerEvents = 'none';
      if (dateEl) dateEl.style.display = '';
      if (eventTitle) eventTitle.style.display = '';
      if (eventInfo) eventInfo.style.display = '';
    }
    if (sceneLive) {
      const mid = (NUM - 1) / 2;
      for (let ci = 0; ci < cards.length; ci++) {
        const c = cards[ci];
        // ring position (auto-rotated)
        const effAng = c.ang + auto;
        const rx = Math.sin(effAng) * radius;
        const rz = Math.cos(effAng) * radius;
        // tape position (centred line, pans sideways)
        const tx = (c.ang / (Math.PI * 2)) * NUM;           // logical index 0..NUM
        const px = (tx - mid) * spacingUnit - tapeX;
        const py = 0;

        // ring/tape position
        let posX = rx + (px - rx) * u;
        let posY = py;
        let posZ = rz + (0 - rz) * u;
        let rotY = (c.ang + auto) + (0 - (c.ang + auto)) * u;

        // corridor position
        if (corridorBlend > 0.001) {
          const side = ci % 2 === 0 ? -1 : 1;
          const cx = side * CORRIDOR_SIDE_SPREAD;
          const cy = CORRIDOR_CAM_Y;
          let cz = -(ci + 1) * CORRIDOR_CARD_GAP;
          const n = Math.floor((-corridorDepth - cz) / CORRIDOR_LOOP);
          cz += n * CORRIDOR_LOOP;
          while (cz + corridorDepth < -30) cz += CORRIDOR_LOOP;
          while (cz + corridorDepth > 30) cz -= CORRIDOR_LOOP;

          posX = posX + (cx - posX) * corridorBlend;
          posY = posY + (cy - posY) * corridorBlend;
          posZ = posZ + (cz - posZ) * corridorBlend;
          rotY = rotY + (0 - rotY) * corridorBlend;
        }

        c.group.position.set(posX, posY, posZ);
        c.group.rotation.y = rotY;

        // hover "stick" — works in both ring and corridor modes
        const on = c === hoverCard;
        const k = 1 - Math.exp(-dt * 10);
        const stickX = corridorBlend > 0.5 ? smx * 0.15 : smx * 0.25;
        const stickOff = corridorBlend > 0.5 ? smx * 0.18 : smx * 0.3;
        const stickLift = corridorBlend > 0.5 ? 0.08 : 0.15;
        c.lean += ((on ? stickX : 0) - c.lean) * k;
        c.off  += ((on ? stickOff : 0) - c.off) * k;
        c.lift += ((on ? stickLift : 0) - c.lift) * k;
        c.ovT  += ((on ? 0 : OVERLAY) - c.ovT) * k;
        c.wrap.rotation.y = c.lean;
        c.wrap.position.set(c.off, c.lift, 0);
        c.overlay.material.opacity = c.ovT;
      }

      ring.rotation.x = -smy * TILT * (1 - u) * (1 - corridorBlend);
      ring.rotation.z = smx * TILT * (1 - u) * (1 - corridorBlend);
      ring.rotation.y = 0;

      // camera: lerp between ring and corridor
      let camX = smx * 0.6;
      let camY = 1.5 - smy * 0.5;
      let camZ = 14;
      if (corridorBlend > 0.001) {
        camX = camX + (0 - camX) * corridorBlend;
        camY = camY + (CORRIDOR_CAM_Y - camY) * corridorBlend;
        camZ = camZ + (-corridorDepth - camZ) * corridorBlend;
      }
      camera.position.set(camX, camY, camZ);
      if (corridorBlend > 0.5) {
        camera.lookAt(0, CORRIDOR_CAM_Y, -corridorDepth - 10);
      } else {
        camera.lookAt(0, -0.45, 0);
      }

      // corridor lights follow the camera
      if (corridorBlend > 0.01) {
        for (const L of corridorLights) {
          let lz = L.base + Math.floor((-corridorDepth - L.base) / CORRIDOR_LIGHT_LOOP) * CORRIDOR_LIGHT_LOOP;
          while (lz + corridorDepth > CORRIDOR_LIGHT_LOOP) lz -= CORRIDOR_LIGHT_LOOP;
          while (lz + corridorDepth < -CORRIDOR_LIGHT_LOOP) lz += CORRIDOR_LIGHT_LOOP;
          L.light.position.set(0, CORRIDOR_CAM_Y + 1.3, lz);
        }
      }
    }

    // ---- экран 2: шторка поднимается снизу, текст заливается построчно ----
    // Стартуем пока кольцо ещё разворачивается (на 60% синей зоны), единый отсчёт для
    // шторки, текста и заливки — без рывка.
    // --- единый линейный поток (всё как в синей зоне) ---
    // Шторка (фон) и текст едут линейно от scroll в постоянной пропорции (×0.7),
    // никакого ease — одинаковая скорость во всех зонах, без стыков.
    // --- единый линейный поток: глобальный scroll, каждый слой = p * коэффициент ---
    // Никаких задержек старта и кусков с разной скоростью — все стартуют вместе и
    // едут с постоянной (константной) скоростью за итерацию.
    // --- премиум-скролл: один scroll, каждая вещь = scroll * константа ---
    // s — просто накопленная прокрутка от старта экрана 2.
    const s = Math.max(0, scroll - CURTAIN_START);

    // Текст миссии: едет вверх со шторкой, проявляется из фейда в начале прокрутки.
    curtainText.style.transform = `translateY(${-s * 0.03 * window.innerHeight}px)`;
    const fadeIn = Math.min(1, Math.max(0, (s - 5) / 3));    // текст проявляется через фейд
    curtainText.style.opacity = fadeIn;

    // Блок "о проекте": едет и проявляется синхронно с текстом миссии.
    const aboutEl = document.getElementById('curtain-about');
    if (aboutEl) {
      aboutEl.style.transform = `translateY(${-s * 0.03 * window.innerHeight}px)`;
      aboutEl.style.opacity = fadeIn;
    }

    // скрываем теглайн и год при появлении шторки
    const hideUI = Math.min(1, Math.max(0, s / 4));
    taglineEl.style.opacity = 1 - hideUI;
    yearEl.style.opacity = 1 - hideUI;
    if (mainTitleEl) mainTitleEl.style.opacity = 1 - Math.min(1, hideUI * 2);

    // --- два хедера: белый поднимается, уходит за край, там подменяется
    // чёрным, который плавно (ease-out) падает обратно ---
    const UP_PX = 120;
    const up = Math.min(1, Math.max(0, s / 4));            // экран 1 → белый уходит вверх (s 0..4)
    const down = Math.min(1, Math.max(0, (s - 8) / 3));    // падает когда фон уже полностью чёрный (s 8..11)
    const easeOut = 1 - (1 - down) * (1 - down);           // ease-out: мягко замедляется книзу
    const whiteY = -(up * UP_PX);
    const darkY = -UP_PX * (1 - easeOut);
    headerWhite.style.transform = `translateY(${whiteY}px)`;
    headerDark.style.transform = `translateY(${darkY}px)`;
    // подмена наверху, когда белый скрылся за краем — перекраски не видно
    const swapped = up >= 1;
    headerWhite.style.opacity = swapped ? 0 : 1;
    headerDark.style.visibility = swapped ? 'visible' : 'hidden';
    headerDark.style.opacity = swapped ? 1 : 0;
    document.body.classList.toggle('nav-dark', swapped);

    // Шторка (миссия): выезжает снизу и уезжает вверх. Без фейда — только физическое движение.
    const curtainY = (1.2 - s * 0.14) * window.innerHeight;
    curtainEl.style.transform = `translateY(${curtainY}px)`;

    // Фото на шторке (фото2): стоит ниже миссии (top:82vh), скроллится вместе
    // со шторкой. На втором экране (миссия) скрыто. Когда верх фото2 доезжает до
    // верха фото1 (18vh), оно останавливается — дальше компенсируем уезд шторки и
    // фото2 стоит на месте, а шторка "стирает" его. Параллакс "было/стало".
    const curtainPhoto = document.querySelector('.curtain-photo');
    if (curtainPhoto) {
      const h = window.innerHeight;
      const top2 = 0.82 * h + curtainY;          // текущий верх фото2 на экране
      const stopTop = 0.18 * h;                  // верх фото1 (центр − половина высоты)
      const shift = top2 < stopTop ? stopTop - top2 : 0;
      curtainPhoto.style.transform = `translateX(-50%) translateY(${shift}px)`;
      const show = Math.min(1, Math.max(0, (curtainY < 0 ? -curtainY / (0.30 * h) : 0)));
      curtainPhoto.style.opacity = String(show);
    }

    // Белая панель едет ровно за нижним краём шторки — синхронно,
    // зазора между чёрным и белым быть не может.
    const curtainBottom = curtainY + 170 * window.innerHeight / 100;
    whiteFillEl.style.transform = `translateY(${curtainBottom}px)`;

    // Body: чёрный пока шторка на экране, белый когда панель закрыла весь экран
    document.body.style.background = curtainBottom > 0 ? '#000' : '#fff';

    const v = 0;
    curtainText.style.color = '#fff';
    const fillProg = Math.min(1, Math.max(0, (s - 3) / 10));       // заливка стартует чуть раньше
    {
      const th = 255 - v;
      const dim = Math.round(v + (th - v) * 0.3);
      const full = `rgb(${th},${th},${th})`, dimC = `rgb(${dim},${dim},${dim})`;
      const M = curtainLines.length;
      for (let L = 0; L < M; L++) {
        const line = curtainLines[L];
        const K = line.words.length;
        let lp = fillProg * M - L;
        lp = lp < 0 ? 0 : lp > 1 ? 1 : lp;
        for (let j = 0; j < K; j++) {
          const w = line.words[j];
          let x = lp * (K + 1) - j;
          x = x < 0 ? 0 : x > 1 ? 1 : x;
          const pct = ((x * 100) | 0);
          if (w._pct === pct) continue;
          w._pct = pct;
          const inSub = w.closest('.t-sub');
          const f = inSub ? 'rgb(108,108,108)' : full;
          const d = inSub ? 'rgb(38,38,38)' : dimC;
          w.style.backgroundImage = `linear-gradient(to right, ${f} ${pct}%, ${d} ${pct}%)`;
        }
      }
    }

    // ---- Афиша (экран 3): слайдер событий, листание «прокрут-действие» ----
    {
      const N = posters.length;
      const appear = Math.min(1, Math.max(0, (s - 8.4) / 3));
      // сборка стопки за шторкой (до ухода шторки)
      const contentProg = Math.min(1, Math.max(0, (s - (STACK_P0 - 5.6)) / 5.6));
      const stack = Math.min(1, Math.max(0, (contentProg - 0.75) / 0.25));
      const stackEase = stack * stack * (3 - 2 * stack);   // smoothstep

      const IN = 1;
      const S = [IN, IN * 0.72, IN * 0.5];       // ближний, средний, дальний
      const STEP = 0.07 * window.innerHeight;    // лесенка между слоями (7vh)
      const TOP = [0, -STEP, -2 * STEP];
      const lerp = (a, b, t) => a + (b - a) * t;
      const easeOut = t => 1 - (1 - t) * (1 - t) * (1 - t);

      const ready = s >= STACK_P0;

      if (!ready) {
        // сборка стопки: первая выходит в центр, остальные выныривают позади
        for (let i = 0; i < N; i++) {
          const el = posters[i];
          let top = 0, scale = IN, op = 1;
          if (i === 0) {
            scale = lerp(IN * 0.3, IN, appear);
            top = lerp(-2 * STEP, TOP[0], appear);
            op = lerp(0, 1, appear);
          } else {
            const st = stackEase;
            scale = lerp(S[i] * 0.3, S[i], st);
            top = lerp(TOP[i] - 0.3 * window.innerHeight, TOP[i], st);
            op = st > 0 ? lerp(0, i === 2 ? 0.4 : 1, st) : 0;
          }
          el.style.visibility = appear > 0 && op > 0.001 ? 'visible' : 'hidden';
          el.style.opacity = op.toFixed(3);
          el.style.zIndex = String(28 - i);
          el.style.transition = 'none';
          el.style.transform = `translate(-50%, calc(-50% + ${top.toFixed(1)}px)) scale(${scale.toFixed(4)})`;
        }
      } else {
        // слайдер: колесо = команда на смену, карточка падает за экран, новая встаёт на её место
        if (!evTransition) {
          if (s >= STACK_P0 + (evPage + 1) * POSTER_DIST && evPage < N - 1) {
            evTransition = { from: evPage, to: evPage + 1, t: 0 };
          } else if (s < STACK_P0 + evPage * POSTER_DIST - 0.4 && evPage > 0) {
            evTransition = { from: evPage, to: evPage - 1, t: 0 };
          }
        }
        if (evTransition) {
          evTransition.t = Math.min(1, evTransition.t + dt / SLIDE_MS);
          if (evTransition.t >= 1) {
            evPage = evTransition.to;
            evTransition = null;
            applyEvent(evPage);
          }
        }
        for (let i = 0; i < N; i++) {
          const el = posters[i];
          let top = 0, scale = IN, vis = i === evPage;
          if (evTransition) {
            const t = easeOut(evTransition.t);
            if (i === evTransition.from) {
              scale = lerp(IN, IN * 1.35, t);                 // падает за экран
              top = lerp(0, 1.2 * window.innerHeight, t);
            } else if (i === evTransition.to) {
              if (evTransition.to > evTransition.from) {
                scale = lerp(S[1], IN, t);                    // выходит на место
                top = lerp(TOP[1], TOP[0], t);
              } else {
                scale = lerp(IN * 1.35, IN, t);               // возвращается из-за экрана
                top = lerp(1.2 * window.innerHeight, TOP[0], t);
              }
              vis = true;
            } else {
              vis = false;
            }
          }
          el.style.visibility = vis ? 'visible' : 'hidden';
          el.style.opacity = '1';
          el.style.zIndex = String(28 - i);
          el.style.transition = 'none';
          el.style.transform = `translate(-50%, calc(-50% + ${top.toFixed(1)}px)) scale(${scale.toFixed(4)})`;
        }
      }
      // Дата: появляется только когда шторка реально приоткрыла низ экрана
      // (анимация не должна идти под шторкой), пропадает, когда шторка
      // возвращается и снова начинает её закрывать.
      if (dateEl) {
        const dateOpen = curtainBottom <= window.innerHeight - 120;
        const titleOpen = curtainBottom <= 620;
        if (dateOpen && !dateShown) {
          dateShown = true;
          dateEl.classList.remove('hide');
          dateEl.classList.add('show');
          eventInfo.classList.add('show');
        } else if (!dateOpen && dateShown) {
          dateShown = false;
          dateEl.classList.remove('show');
          dateEl.classList.add('hide');
          eventInfo.classList.remove('show');
        }
        if (titleOpen && !titleShown) {
          titleShown = true;
          eventTitle.classList.add('show');
        } else if (!titleOpen && titleShown) {
          titleShown = false;
          eventTitle.classList.remove('show');
        }
      }
      stackEl.style.perspective = '';
    }

    updateDebug();
    if (sceneLive) renderer.render(scene, camera);

    // точка за курсором: плавно догоняет позицию мыши (инерция, как Obys)
    if (cursorDot.classList.contains('on')) {
      dmx += (pmx - dmx) * 0.15;
      dmy += (pmy - dmy) * 0.15;
      dScale += (pScale - dScale) * 0.15;
      cursorDot.style.transform = `translate3d(${dmx.toFixed(1)}px, ${dmy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${dScale.toFixed(2)})`;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
