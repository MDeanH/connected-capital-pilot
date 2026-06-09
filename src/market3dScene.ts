import * as THREE from 'three'
import RAW from './market3d-data.json'

// ---------------------------------------------------------------------------
// Shared scene construction for the 3D Market environment / Market Quest game.
// Data comes from scripts/build_market3d_data.py (real repo datasets).
// ---------------------------------------------------------------------------
export interface Metro {
  name: string
  rank: number      // market-size rank from metros-list.json
  mu: number        // annualized home-value return (Zillow ZHVI, 2000+)
  sigma: number     // de-smoothed annualized volatility
  n: number         // observations behind the estimate
  rentMu?: number   // annualized rent growth (Zillow ZORI) where available
}
export interface Ridge { start: string; end: string; points: number[] }
export interface MacroSeries {
  id: string
  name: string
  category: string
  latest: number
  yoy: number | null
  annReturn: number | null
  annVol: number | null
}
export interface Market3DData {
  generated: string
  metros: Metro[]
  zhvi: Ridge
  mortgage: Ridge
  houst: Ridge
  macro: MacroSeries[]
}

export const DATA = RAW as unknown as Market3DData

// Layout constants (world units)
export const CITY_SPIRAL = 2.05
export const TOWER_H_SCALE = 215
export const RING_RADIUS = 36
export const RIDGE_DIST = 50
export const RIDGE_LEN = 86
export const WORLD_RADIUS = 112   // soft boundary for the game

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export function towerColor(sigma: number): THREE.Color {
  // low risk = teal, high risk = red (de-smoothed sigma, ~3%..30%)
  const t = THREE.MathUtils.clamp((sigma - 0.04) / 0.22, 0, 1)
  return new THREE.Color().setHSL(THREE.MathUtils.lerp(0.52, 0.0, t), 0.85, 0.5)
}

export function towerHeight(mu: number): number {
  return Math.max(0.25, mu * TOWER_H_SCALE)
}

export function makeLabel(text: string, fg = '#d9e6ff', fontPx = 46, worldH = 2.2): THREE.Sprite {
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

export interface OrbSpec { id: string; position: THREE.Vector3; fact: string }

export interface EnvHandles {
  towers: Map<string, THREE.Mesh>      // metro name -> tower mesh
  pillars: Map<string, THREE.Mesh>     // macro id -> pillar mesh
  pickables: THREE.Object3D[]          // everything hoverable in orbit mode
  orbSpecs: OrbSpec[]                  // collectible positions + facts (game mode)
  baselineCagr: number                 // national ZHVI CAGR since 2000
}

export function metroPosition(rank: number): { x: number; z: number } {
  const angle = rank * GOLDEN_ANGLE
  const radius = 3.2 + CITY_SPIRAL * Math.sqrt(rank)
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
}

function buildCity(scene: THREE.Scene, h: EnvHandles): void {
  const box = new THREE.BoxGeometry(1, 1, 1)
  for (const m of DATA.metros) {
    const { x, z } = metroPosition(m.rank)
    const ht = towerHeight(m.mu)
    const color = towerColor(m.sigma)
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.38),
      roughness: 0.35,
      metalness: 0.25,
    })
    const tower = new THREE.Mesh(box, mat)
    tower.scale.set(1.18, ht, 1.18)
    tower.position.set(x, ht / 2, z)
    tower.userData = { kind: 'metro', ...m }
    scene.add(tower)
    h.towers.set(m.name, tower)
    h.pickables.push(tower)
    if (m.rank <= 10) {
      const label = makeLabel(m.name.split(',')[0], '#ffffff', 44, 1.5)
      label.position.set(x, ht + 1.4, z)
      scene.add(label)
    }
  }
}

function buildRidge(
  scene: THREE.Scene,
  h: EnvHandles,
  ridge: Ridge,
  title: string,
  colorHex: number,
  maxH: number,
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
  h.pickables.push(mesh)

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
  scene.add(g)
  return g
}

function buildMacroRing(scene: THREE.Scene, h: EnvHandles): void {
  const cyl = new THREE.CylinderGeometry(0.55, 0.7, 1, 20)
  DATA.macro.forEach((s, i) => {
    const angle = (i / DATA.macro.length) * Math.PI * 2
    const yoy = s.yoy ?? 0
    const ht = 1.2 + Math.min(8, Math.abs(yoy)) * 0.95
    const color = new THREE.Color(s.yoy == null ? 0x64748b : yoy >= 0 ? 0x22c55e : 0xef4444)
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.45),
      roughness: 0.4,
    })
    const p = new THREE.Mesh(cyl, mat)
    p.scale.y = ht
    p.position.set(Math.cos(angle) * RING_RADIUS, ht / 2, Math.sin(angle) * RING_RADIUS)
    p.userData = { kind: 'macro', ...s }
    scene.add(p)
    h.pillars.set(s.id, p)
    h.pickables.push(p)
    const label = makeLabel(s.id, '#aebfe6', 36, 1.25)
    label.position.set(p.position.x, ht + 1.1, p.position.z)
    scene.add(label)
  })
}

function argmax(arr: number[], from = 0, to = arr.length): number {
  let best = from
  for (let i = from; i < Math.min(to, arr.length); i++) if (arr[i] > arr[best]) best = i
  return best
}
function argmin(arr: number[], from = 0, to = arr.length): number {
  let best = from
  for (let i = from; i < Math.min(to, arr.length); i++) if (arr[i] < arr[best]) best = i
  return best
}
function monthLabel(start: string, idx: number): string {
  const y = parseInt(start.slice(0, 4), 10)
  const m = parseInt(start.slice(5, 7), 10) - 1 + idx
  return `${y + Math.floor(m / 12)}`
}

function ridgeWorldPoint(group: THREE.Group, points: number[], idx: number, maxH: number): THREE.Vector3 {
  const maxV = Math.max(...points)
  const local = new THREE.Vector3(
    (idx / (points.length - 1)) * RIDGE_LEN,
    (points[idx] / maxV) * maxH + 2.2,
    0.5,
  )
  group.updateMatrixWorld(true)
  return group.localToWorld(local)
}

// Collectible facts, all computed from the actual series/catalog values.
function computeOrbSpecs(
  zhviG: THREE.Group, mortG: THREE.Group, houstG: THREE.Group, h: EnvHandles,
): OrbSpec[] {
  const orbs: OrbSpec[] = []
  const z = DATA.zhvi, mo = DATA.mortgage, ho = DATA.houst

  // 2008 crash valley on the ZHVI ridge
  const iPeak = argmax(z.points, 0, 132)
  const iTrough = argmin(z.points, iPeak, iPeak + 96)
  const drop = (1 - z.points[iTrough] / z.points[iPeak]) * 100
  orbs.push({
    id: 'crash',
    position: ridgeWorldPoint(zhviG, z.points, iTrough, 14),
    fact: `THE CRASH VALLEY — US home values fell ${drop.toFixed(1)}% from the ${monthLabel(z.start, iPeak)} peak to the ${monthLabel(z.start, iTrough)} trough (Zillow ZHVI). It took until 2017 to fully recover.`,
  })

  // 1981 Volcker peak on the mortgage wall
  const iRate = argmax(mo.points)
  orbs.push({
    id: 'volcker',
    position: ridgeWorldPoint(mortG, mo.points, iRate, 12),
    fact: `THE VOLCKER SUMMIT — the 30-yr mortgage rate peaked at ${mo.points[iRate].toFixed(2)}% in ${monthLabel(mo.start, iRate)}. Today it is ${mo.points[mo.points.length - 1].toFixed(2)}%. Financing cost is the gravity of this whole city.`,
  })

  // 2009 housing-starts canyon
  const iHMax = argmax(ho.points)
  const iHMin = argmin(ho.points, iHMax)
  orbs.push({
    id: 'canyon',
    position: ridgeWorldPoint(houstG, ho.points, iHMin, 10),
    fact: `THE SUPPLY CANYON — housing starts collapsed ${((1 - ho.points[iHMin] / ho.points[iHMax]) * 100).toFixed(0)}%, from ${Math.round(ho.points[iHMax])}k/yr (${monthLabel(ho.start, iHMax)}) to ${Math.round(ho.points[iHMin])}k/yr (${monthLabel(ho.start, iHMin)}). Under-building since then still shapes today's inventory shortage.`,
  })

  // Metro superlatives from the distribution catalog
  const byMu = [...DATA.metros].sort((a, b) => b.mu - a.mu)[0]
  const bySigma = [...DATA.metros].sort((a, b) => b.sigma - a.sigma)[0]
  const byRatio = [...DATA.metros].sort((a, b) => b.mu / b.sigma - a.mu / a.sigma)[0]
  const overTower = (m: Metro) => {
    const t = h.towers.get(m.name)!
    return t.position.clone().setY(towerHeight(m.mu) + 3)
  }
  orbs.push({
    id: 'growth',
    position: overTower(byMu),
    fact: `GROWTH CHAMPION — ${byMu.name} has the highest home-value growth of the top-150 metros: ${(byMu.mu * 100).toFixed(1)}%/yr since 2000.`,
  })
  orbs.push({
    id: 'risk',
    position: overTower(bySigma),
    fact: `THE VOLCANO — ${bySigma.name} is the most volatile major market: de-smoothed σ ${(bySigma.sigma * 100).toFixed(1)}%/yr. High growth here comes with violent drawdowns.`,
  })
  orbs.push({
    id: 'sharpe',
    position: overTower(byRatio),
    fact: `THE QUIET COMPOUNDER — ${byRatio.name} has the best growth-per-unit-risk in the top 150: ${(byRatio.mu * 100).toFixed(1)}%/yr at only ${(byRatio.sigma * 100).toFixed(1)}% σ. Diligence loves boring.`,
  })

  // Financing pillar + city-center baseline
  const fin = h.pillars.get('MORTGAGE30US')
  if (fin) {
    orbs.push({
      id: 'financing',
      position: fin.position.clone().add(new THREE.Vector3(0, 4.5, 0)),
      fact: `THE RING OF CONTEXT — 17 macro series (Case-Shiller, FHFA, CPI rents, fed funds, unemployment…) ring the city as base rates. Green pillars are rising YoY, red are falling.`,
    })
  }
  orbs.push({
    id: 'baseline',
    position: new THREE.Vector3(0, 24, 0),
    fact: `THE NATIONAL BASELINE — US home values compounded at ${(h.baselineCagr * 100).toFixed(2)}%/yr since 2000 (Zillow ZHVI). Beat this or you haven't added alpha.`,
  })
  return orbs
}

// Builds lights, ground, city, ring and ridges into the scene.
export function buildEnvironment(scene: THREE.Scene): EnvHandles {
  scene.background = new THREE.Color(0x05070f)
  scene.fog = new THREE.FogExp2(0x05070f, 0.0042)

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

  const zp = DATA.zhvi.points
  const years = zp.length / 12
  const handles: EnvHandles = {
    towers: new Map(),
    pillars: new Map(),
    pickables: [],
    orbSpecs: [],
    baselineCagr: Math.pow(zp[zp.length - 1] / zp[0], 1 / years) - 1,
  }

  buildCity(scene, handles)
  buildMacroRing(scene, handles)

  const zhviG = buildRidge(
    scene, handles, DATA.zhvi, 'US Home Values — Zillow ZHVI', 0x38bdf8, 14,
    v => `$${Math.round(v / 1000)}k`,
  )
  zhviG.position.set(-RIDGE_LEN / 2, 0, -RIDGE_DIST)
  const mortG = buildRidge(
    scene, handles, DATA.mortgage, '30-Year Mortgage Rate — FRED', 0xf59e0b, 12,
    v => `${v.toFixed(1)}%`,
  )
  mortG.rotation.y = Math.PI
  mortG.position.set(RIDGE_LEN / 2, 0, RIDGE_DIST)
  const houstG = buildRidge(
    scene, handles, DATA.houst, 'US Housing Starts — FRED', 0xa78bfa, 10,
    v => `${Math.round(v)}k/yr`,
  )
  houstG.rotation.y = Math.PI / 2
  houstG.position.set(-RIDGE_DIST, 0, RIDGE_LEN / 2)

  handles.orbSpecs = computeOrbSpecs(zhviG, mortG, houstG, handles)
  return handles
}

export function disposeScene(scene: THREE.Scene): void {
  scene.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach(m => m.dispose())
    else mat?.dispose()
    const map = (mat as THREE.SpriteMaterial | undefined)?.map
    map?.dispose()
  })
}
