import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import RAW from './market3d-data.json'

// ---------------------------------------------------------------------------
// Data shapes (built by scripts/build_market3d_data.py from the repo datasets)
// ---------------------------------------------------------------------------
interface Metro {
  name: string
  rank: number      // market-size rank from metros-list.json
  mu: number        // annualized home-value return (Zillow ZHVI, 2000+)
  sigma: number     // de-smoothed annualized volatility
  n: number         // observations behind the estimate
  rentMu?: number   // annualized rent growth (Zillow ZORI) where available
}
interface Ridge { start: string; end: string; points: number[] }
interface MacroSeries {
  id: string
  name: string
  category: string
  latest: number
  yoy: number | null
  annReturn: number | null
  annVol: number | null
}
interface Market3DData {
  generated: string
  metros: Metro[]
  zhvi: Ridge
  mortgage: Ridge
  houst: Ridge
  macro: MacroSeries[]
}

const DATA = RAW as unknown as Market3DData

// Layout constants (world units)
const CITY_SPIRAL = 2.05      // phyllotaxis radial spread
const TOWER_H_SCALE = 215     // tower height per unit of annual return
const RING_RADIUS = 36        // macro indicator ring
const RIDGE_DIST = 50         // distance of time-series ridges from center
const RIDGE_LEN = 86

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

function towerColor(sigma: number): THREE.Color {
  // low risk = teal, high risk = red (de-smoothed sigma, ~3%..30%)
  const t = THREE.MathUtils.clamp((sigma - 0.04) / 0.22, 0, 1)
  return new THREE.Color().setHSL(THREE.MathUtils.lerp(0.52, 0.0, t), 0.85, 0.5)
}

function makeLabel(text: string, fg = '#d9e6ff', fontPx = 46, worldH = 2.2): THREE.Sprite {
  const pad = 22
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d')!
  ctx.font = `600 ${fontPx}px Inter, system-ui, sans-serif`
  cv.width = Math.ceil(ctx.measureText(text).width) + pad * 2
  cv.height = fontPx + pad * 2
  const c2 = cv.getContext('2d')!
  c2.font = `600 ${fontPx}px Inter, system-ui, sans-serif`
  c2.fillStyle = 'rgba(7,11,22,0.62)'
  c2.beginPath()
  c2.roundRect(0, 0, cv.width, cv.height, 14)
  c2.fill()
  c2.fillStyle = fg
  c2.textBaseline = 'middle'
  c2.fillText(text, pad, cv.height / 2)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
  sprite.scale.set((cv.width / cv.height) * worldH, worldH, 1)
  return sprite
}

// Metro towers in a phyllotaxis spiral: downtown = biggest markets.
function buildCity(metros: Metro[], pickables: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group()
  const box = new THREE.BoxGeometry(1, 1, 1)
  for (const m of metros) {
    const angle = m.rank * GOLDEN_ANGLE
    const radius = 3.2 + CITY_SPIRAL * Math.sqrt(m.rank)
    const h = Math.max(0.25, m.mu * TOWER_H_SCALE)
    const color = towerColor(m.sigma)
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.38),
      roughness: 0.35,
      metalness: 0.25,
    })
    const tower = new THREE.Mesh(box, mat)
    tower.scale.set(1.18, h, 1.18)
    tower.position.set(Math.cos(angle) * radius, h / 2, Math.sin(angle) * radius)
    tower.userData = { kind: 'metro', ...m }
    g.add(tower)
    pickables.push(tower)
    if (m.rank <= 10) {
      const label = makeLabel(m.name.split(',')[0], '#ffffff', 44, 1.5)
      label.position.set(tower.position.x, h + 1.4, tower.position.z)
      g.add(label)
    }
  }
  return g
}

// A time series extruded into a glowing mountain ridge.
function buildRidge(
  ridge: Ridge,
  title: string,
  colorHex: number,
  maxH: number,
  pickables: THREE.Object3D[],
  fmt: (v: number) => string,
): THREE.Group {
  const g = new THREE.Group()
  const pts = ridge.points
  const maxV = Math.max(...pts)
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  const crest: THREE.Vector3[] = []
  pts.forEach((v, i) => {
    const x = (i / (pts.length - 1)) * RIDGE_LEN
    const y = (v / maxV) * maxH
    shape.lineTo(x, y)
    crest.push(new THREE.Vector3(x, y + 0.06, 0.45))
  })
  shape.lineTo(RIDGE_LEN, 0)
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false })
  const color = new THREE.Color(colorHex)
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.3),
      roughness: 0.45,
      metalness: 0.15,
    }),
  )
  mesh.userData = {
    kind: 'ridge',
    title,
    detail: `${fmt(pts[0])} (${ridge.start})  →  ${fmt(pts[pts.length - 1])} (${ridge.end})  •  peak ${fmt(maxV)}`,
  }
  g.add(mesh)
  pickables.push(mesh)

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(crest),
    new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(1.6) }),
  )
  g.add(line)

  const t = makeLabel(title, '#eaf2ff', 50, 2.6)
  t.position.set(RIDGE_LEN / 2, maxH + 2.6, 0.5)
  g.add(t)
  const y0 = makeLabel(ridge.start.slice(0, 4), '#8fa8d8', 40, 1.6)
  y0.position.set(0, 1.4, 0.5)
  g.add(y0)
  const y1 = makeLabel(ridge.end.slice(0, 4), '#8fa8d8', 40, 1.6)
  y1.position.set(RIDGE_LEN, 1.4, 0.5)
  g.add(y1)
  return g
}

// Ring of macro pillars: green rising YoY, red falling.
function buildMacroRing(series: MacroSeries[], pickables: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group()
  const cyl = new THREE.CylinderGeometry(0.55, 0.7, 1, 20)
  series.forEach((s, i) => {
    const angle = (i / series.length) * Math.PI * 2
    const yoy = s.yoy ?? 0
    const h = 1.2 + Math.min(8, Math.abs(yoy)) * 0.95
    const color = new THREE.Color(s.yoy == null ? 0x64748b : yoy >= 0 ? 0x22c55e : 0xef4444)
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.45),
      roughness: 0.4,
    })
    const p = new THREE.Mesh(cyl, mat)
    p.scale.y = h
    p.position.set(Math.cos(angle) * RING_RADIUS, h / 2, Math.sin(angle) * RING_RADIUS)
    p.userData = { kind: 'macro', ...s }
    g.add(p)
    pickables.push(p)
    const label = makeLabel(s.id, '#aebfe6', 36, 1.25)
    label.position.set(p.position.x, h + 1.1, p.position.z)
    g.add(label)
  })
  return g
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  return v == null ? '—' : `${(v * 100).toFixed(digits)}%`
}

function tooltipHtml(d: Record<string, unknown>): string {
  if (d.kind === 'metro') {
    const m = d as unknown as Metro
    return (
      `<strong>#${m.rank} ${m.name}</strong><br/>` +
      `Home-value growth <strong>${fmtPct(m.mu)}/yr</strong> • de-smoothed σ <strong>${fmtPct(m.sigma)}</strong><br/>` +
      `${m.rentMu != null ? `Rent growth ${fmtPct(m.rentMu)}/yr • ` : ''}${m.n} monthly obs (Zillow ZHVI${m.rentMu != null ? ' + ZORI' : ''})`
    )
  }
  if (d.kind === 'macro') {
    const s = d as unknown as MacroSeries
    return (
      `<strong>${s.name}</strong> <span style="opacity:.7">(${s.id})</span><br/>` +
      `Latest <strong>${s.latest.toLocaleString()}</strong> • YoY <strong>${s.yoy == null ? '—' : s.yoy.toFixed(2) + '%'}</strong><br/>` +
      `${s.category}${s.annReturn != null ? ` • ann. return ${fmtPct(s.annReturn)} • σ* ${fmtPct(s.annVol)}` : ''}`
    )
  }
  return `<strong>${d.title}</strong><br/>${d.detail}`
}

export default function Market3D() {
  const mountRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [autoRotate, setAutoRotate] = useState(true)
  const autoRotateRef = useRef(autoRotate)
  autoRotateRef.current = autoRotate

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x05070f)
    scene.fog = new THREE.FogExp2(0x05070f, 0.0042)

    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, 600)
    camera.position.set(46, 30, 62)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 5, 0)
    controls.maxPolarAngle = 1.5
    controls.minDistance = 10
    controls.maxDistance = 220
    controls.autoRotateSpeed = 0.5

    // Lights
    scene.add(new THREE.AmbientLight(0x8899bb, 0.55))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(40, 70, 30)
    scene.add(key)
    const cool = new THREE.PointLight(0x3b82f6, 900, 160)
    cool.position.set(-30, 35, -20)
    scene.add(cool)
    const warm = new THREE.PointLight(0xf59e0b, 500, 140)
    warm.position.set(35, 22, 45)
    scene.add(warm)

    // Ground
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(120, 72).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0a0f1e, roughness: 0.95 }),
    )
    scene.add(ground)
    const grid = new THREE.GridHelper(240, 48, 0x1d2a4a, 0x131c33)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.5
    grid.position.y = 0.02
    scene.add(grid)

    // Districts (all real data from the repo)
    const pickables: THREE.Object3D[] = []
    scene.add(buildCity(DATA.metros, pickables))
    scene.add(buildMacroRing(DATA.macro, pickables))

    const zhvi = buildRidge(
      DATA.zhvi, 'US Home Values — Zillow ZHVI', 0x38bdf8, 14, pickables,
      v => `$${Math.round(v / 1000)}k`,
    )
    zhvi.position.set(-RIDGE_LEN / 2, 0, -RIDGE_DIST)
    scene.add(zhvi)

    const mort = buildRidge(
      DATA.mortgage, '30-Year Mortgage Rate — FRED', 0xf59e0b, 12, pickables,
      v => `${v.toFixed(1)}%`,
    )
    mort.rotation.y = Math.PI
    mort.position.set(RIDGE_LEN / 2, 0, RIDGE_DIST)
    scene.add(mort)

    const houst = buildRidge(
      DATA.houst, 'US Housing Starts — FRED', 0xa78bfa, 10, pickables,
      v => `${Math.round(v)}k/yr`,
    )
    houst.rotation.y = Math.PI / 2
    houst.position.set(-RIDGE_DIST, 0, RIDGE_LEN / 2)
    scene.add(houst)

    // Post-processing (bloom night-city glow)
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.5, 0.65, 0.2,
    ))
    composer.addPass(new OutputPass())

    // Hover tooltip
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const onPointerMove = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(pickables, false)[0]
      const tip = tipRef.current
      if (!tip) return
      if (hit) {
        tip.style.display = 'block'
        tip.style.left = `${ev.clientX - r.left + 14}px`
        tip.style.top = `${ev.clientY - r.top + 14}px`
        tip.innerHTML = tooltipHtml(hit.object.userData)
        renderer.domElement.style.cursor = 'pointer'
      } else {
        tip.style.display = 'none'
        renderer.domElement.style.cursor = 'grab'
      }
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove)

    const observer = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      composer.setSize(w, h)
    })
    observer.observe(mount)

    let raf = 0
    const animate = () => {
      raf = requestAnimationFrame(animate)
      controls.autoRotate = autoRotateRef.current
      controls.update()
      composer.render()
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      controls.dispose()
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else mat?.dispose()
        const map = (mat as THREE.SpriteMaterial | undefined)?.map
        map?.dispose()
      })
      composer.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: 'max(540px, calc(100vh - 230px))', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border, #1e293b)' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div ref={tipRef} style={{
        display: 'none', position: 'absolute', zIndex: 3, pointerEvents: 'none', maxWidth: 340,
        background: 'rgba(8,12,24,0.92)', border: '1px solid #2b3a5e', borderRadius: 8,
        padding: '8px 10px', color: '#dbe7ff', fontSize: '0.8rem', lineHeight: 1.45,
      }} />
      <div style={{
        position: 'absolute', zIndex: 2, top: 12, left: 12, maxWidth: 380,
        background: 'rgba(8,12,24,0.78)', border: '1px solid #22304f', borderRadius: 10,
        padding: '10px 14px', color: '#c4d3f2', fontSize: '0.78rem', lineHeight: 1.55,
      }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>US Market — 3D Environment</div>
        <div style={{ opacity: 0.85, marginTop: 4 }}>
          <strong>City</strong>: 150 largest metros — height = home-value growth/yr,
          color = de-smoothed risk (<span style={{ color: '#2dd4bf' }}>calm</span> → <span style={{ color: '#f87171' }}>volatile</span>),
          center = biggest markets.<br />
          <strong>Ring</strong>: 17 macro indicators (<span style={{ color: '#4ade80' }}>rising</span> / <span style={{ color: '#f87171' }}>falling</span> YoY).<br />
          <strong>Ridges</strong>: ZHVI {DATA.zhvi.start.slice(0, 4)}–{DATA.zhvi.end.slice(0, 4)} • mortgage rate {DATA.mortgage.start.slice(0, 4)}–{DATA.mortgage.end.slice(0, 4)} • housing starts {DATA.houst.start.slice(0, 4)}–{DATA.houst.end.slice(0, 4)}.
        </div>
        <div style={{ marginTop: 6, opacity: 0.7 }}>Drag to orbit • scroll to zoom • hover anything for diligence stats.</div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoRotate} onChange={e => setAutoRotate(e.target.checked)} /> Auto-rotate
        </label>
      </div>
    </div>
  )
}
